import type { CasterPokemonInfo } from '@/types/caster';
import { getBestStabEffectiveness } from '@/lib/pkmn/type-chart';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

export interface WinCondition {
  player: 1 | 2;
  type: 'sweeper' | 'speed_advantage' | 'no_answer' | 'defensive_core';
  description: string;
  importance: number; // 1-5
}

/**
 * Identify win conditions for each team based on type matchups,
 * speed tiers, and team composition. Pure function.
 *
 * `locale` is the language of `description`; `dataLocale` the language of
 * the Pokémon names in it. Both default to English.
 */
export function analyzeWinConditions(
  p1Pokemon: CasterPokemonInfo[],
  p2Pokemon: CasterPokemonInfo[],
  p1Name: string,
  p2Name: string,
  locale: Locale = 'en',
  dataLocale: Locale = locale,
): WinCondition[] {
  const t = createTranslator(broadcastCasterMessages, locale);
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const conditions: WinCondition[] = [];

  // ── Primary sweeper threat (highest offensive BST) ─────────────
  function findSweeper(team: CasterPokemonInfo[], player: 1 | 2, name: string) {
    const sorted = [...team].sort((a, b) => {
      const aOff = Math.max(a.baseStats.atk, a.baseStats.spa) + a.baseStats.spe;
      const bOff = Math.max(b.baseStats.atk, b.baseStats.spa) + b.baseStats.spe;
      return bOff - aOff;
    });
    if (sorted.length > 0) {
      conditions.push({
        player,
        type: 'sweeper',
        description: t('generated.sweeper', { pokemon: species(sorted[0].species), name }),
        importance: 3,
      });
    }
  }

  findSweeper(p1Pokemon, 1, p1Name);
  findSweeper(p2Pokemon, 2, p2Name);

  // ── Speed advantage ────────────────────────────────────────────
  const p1MaxSpeed = Math.max(...p1Pokemon.map((p) => p.speedTiers.max.raw), 0);
  const p2MaxSpeed = Math.max(...p2Pokemon.map((p) => p.speedTiers.max.raw), 0);
  if (p1MaxSpeed > p2MaxSpeed + 20) {
    conditions.push({
      player: 1,
      type: 'speed_advantage',
      description: t('generated.speedAdvantage', { name: p1Name, fast: p1MaxSpeed, slow: p2MaxSpeed }),
      importance: 3,
    });
  } else if (p2MaxSpeed > p1MaxSpeed + 20) {
    conditions.push({
      player: 2,
      type: 'speed_advantage',
      description: t('generated.speedAdvantage', { name: p2Name, fast: p2MaxSpeed, slow: p1MaxSpeed }),
      importance: 3,
    });
  }

  // ── "If X goes down, no answer to Y" ──────────────────────────
  function findNoAnswer(
    attackingTeam: CasterPokemonInfo[],
    defendingTeam: CasterPokemonInfo[],
    atkPlayer: 1 | 2,
    atkName: string,
    defName: string
  ) {
    for (const threat of attackingTeam) {
      const checks = defendingTeam.filter((def) => {
        const eff = getBestStabEffectiveness(threat.types, def.types);
        // Defender resists or is immune AND can threaten back
        const resists = eff <= 0.5;
        const threatens = getBestStabEffectiveness(def.types, threat.types) >= 2;
        return resists || threatens;
      });
      if (checks.length === 1) {
        conditions.push({
          player: atkPlayer,
          type: 'no_answer',
          description: t('generated.noAnswer', {
            check: species(checks[0].species),
            name: defName,
            threat: species(threat.species),
          }),
          importance: 5,
        });
      }
    }
  }

  findNoAnswer(p1Pokemon, p2Pokemon, 1, p1Name, p2Name);
  findNoAnswer(p2Pokemon, p1Pokemon, 2, p2Name, p1Name);

  // ── Defensive core ─────────────────────────────────────────────
  function findDefensiveCore(team: CasterPokemonInfo[], player: 1 | 2, name: string) {
    const bulky = team
      .filter((p) => p.baseStats.hp + p.baseStats.def + p.baseStats.spd > 300)
      .sort((a, b) => {
        const aBulk = a.baseStats.hp + a.baseStats.def + a.baseStats.spd;
        const bBulk = b.baseStats.hp + b.baseStats.def + b.baseStats.spd;
        return bBulk - aBulk;
      });
    if (bulky.length >= 2) {
      conditions.push({
        player,
        type: 'defensive_core',
        description: t('generated.defensiveCore', { name, a: species(bulky[0].species), b: species(bulky[1].species) }),
        importance: 2,
      });
    }
  }

  findDefensiveCore(p1Pokemon, 1, p1Name);
  findDefensiveCore(p2Pokemon, 2, p2Name);

  return conditions.sort((a, b) => b.importance - a.importance);
}
