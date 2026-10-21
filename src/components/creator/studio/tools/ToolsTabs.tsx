'use client';

import { useState, useCallback } from 'react';
import type { PokemonSet } from '@/types/team';
import type { CalcResult, CalcResultSuccess } from '@/types/calc';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeNature } from '@/lib/pkmn/i18n/names/misc';
import { formatKo } from '@/lib/pkmn/i18n/calc-text';

type ToolTab = 'speed' | 'damage' | 'field';

/**
 * One damage-calc line. Kept as data (English move name, numbers, KO info)
 * and rendered in the viewer's language, so a language switch re-renders it.
 */
type DamageRow =
  | { kind: 'result'; move: string; minPct: number; maxPct: number; result: CalcResultSuccess }
  | { kind: 'calcError'; move: string };

type DamageState =
  | { status: 'idle' }
  | { status: 'rows'; rows: DamageRow[] }
  | { status: 'noMoves' }
  | { status: 'failed' };

interface ToolsTabsProps {
  pokemon1: PokemonSet | null;
  pokemon2: PokemonSet | null;
  generation: number;
}

/**
 * ToolsTabs — tabbed interface for speed calc, damage calc, and field conditions.
 * Second-screen companion to the Cast Studio.
 */
export default function ToolsTabs({ pokemon1, pokemon2, generation }: ToolsTabsProps) {
  const t = useT(creatorStudioMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const [activeTab, setActiveTab] = useState<ToolTab>('speed');
  const [speedResults, setSpeedResults] = useState<{ p1: number | null; p2: number | null }>({ p1: null, p2: null });
  const [damage, setDamage] = useState<DamageState>({ status: 'idle' });
  const [calcLoading, setCalcLoading] = useState(false);

  const calcSpeed = useCallback(async () => {
    if (!pokemon1?.species || !pokemon2?.species) return;
    // Call speed calc for both pokemon
    // Show EV-based comparison for now — actual calc needs base stats from API
    setSpeedResults({ p1: pokemon1.evs.spe, p2: pokemon2.evs.spe });
  }, [pokemon1, pokemon2]);

  const calcDamage = useCallback(async () => {
    if (!pokemon1?.species || !pokemon2?.species) return;
    setCalcLoading(true);
    try {
      // Calculate all moves from p1 vs p2
      const moves = pokemon1.moves.filter(Boolean);
      if (moves.length === 0) {
        setDamage({ status: 'noMoves' });
        return;
      }

      const rows: DamageRow[] = [];
      for (const move of moves) {
        const res = await fetch('/api/calc/damage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generation,
            attacker: {
              species: pokemon1.species,
              item: pokemon1.item || undefined,
              ability: pokemon1.ability || undefined,
              nature: pokemon1.nature,
              evs: pokemon1.evs,
              ivs: pokemon1.ivs,
              level: pokemon1.level,
            },
            defender: {
              species: pokemon2.species,
              item: pokemon2.item || undefined,
              ability: pokemon2.ability || undefined,
              nature: pokemon2.nature,
              evs: pokemon2.evs,
              ivs: pokemon2.ivs,
              level: pokemon2.level,
            },
            move,
          }),
        });
        const json = await res.json();
        const r: CalcResult | undefined = json.success ? json.data?.results?.[0] : undefined;
        // A per-move `error` (unknown move, calc failure) carries no numbers: show the calc-error line.
        if (r && !('error' in r)) {
          rows.push({ kind: 'result', move, minPct: r.damage.min_pct, maxPct: r.damage.max_pct, result: r });
        } else {
          rows.push({ kind: 'calcError', move });
        }
      }
      setDamage({ status: 'rows', rows });
    } catch {
      setDamage({ status: 'failed' });
    } finally {
      setCalcLoading(false);
    }
  }, [pokemon1, pokemon2, generation]);

  /** One damage line in the viewer's language; the KO phrase is the calc's own text in English and the structured `ko` field plus the translated "after" items in German. */
  const damageLine = (row: DamageRow): string => {
    const move = localizeMove(row.move, dataLocale);
    if (row.kind === 'calcError') return t('tools.damage.calcError', { move });
    const min = formatter.percentOf(row.minPct, 1);
    const max = formatter.percentOf(row.maxPct, 1);
    const ko = formatKo(row.result.ko, locale, row.result.ko_chance);
    return ko
      ? t('tools.damage.resultWithKo', { move, min, max, ko })
      : t('tools.damage.result', { move, min, max });
  };

  const damageLines: string[] =
    damage.status === 'rows'
      ? damage.rows.map(damageLine)
      : damage.status === 'noMoves'
        ? [t('tools.damage.noMoves')]
        : damage.status === 'failed'
          ? [t('tools.damage.failed')]
          : [];

  const tabClass = (tab: ToolTab) => `
    px-4 py-2 text-sm font-heading font-bold transition-colors rounded-t-poke-md
    ${activeTab === tab
      ? 'bg-poke-surface text-poke-accent border-b-2 border-poke-accent'
      : 'text-poke-text-secondary hover:text-poke-text-primary'
    }
  `;

  const species1 = pokemon1?.species ? localizeSpecies(pokemon1.species, dataLocale) : '';
  const species2 = pokemon2?.species ? localizeSpecies(pokemon2.species, dataLocale) : '';

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-poke-border">
        <button onClick={() => setActiveTab('speed')} className={tabClass('speed')}>
          {t('tools.tabs.speed')}
        </button>
        <button onClick={() => setActiveTab('damage')} className={tabClass('damage')}>
          {t('tools.tabs.damage')}
        </button>
        <button onClick={() => setActiveTab('field')} className={tabClass('field')}>
          {t('tools.tabs.field')}
        </button>
      </div>

      {/* Tab content */}
      <div className="rounded-b-poke-lg border border-t-0 border-poke-border bg-poke-surface p-4">
        {activeTab === 'speed' && (
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-poke-text-primary">{t('tools.speed.title')}</h3>
            {pokemon1?.species && pokemon2?.species ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-poke-text-primary">{species1}</span>
                  <span className="text-sm font-mono text-poke-text-secondary">
                    {t('tools.speed.evsNature', { evs: pokemon1.evs.spe, nature: localizeNature(pokemon1.nature, dataLocale) })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-poke-text-primary">{species2}</span>
                  <span className="text-sm font-mono text-poke-text-secondary">
                    {t('tools.speed.evsNature', { evs: pokemon2.evs.spe, nature: localizeNature(pokemon2.nature, dataLocale) })}
                  </span>
                </div>
                <button
                  onClick={calcSpeed}
                  className="w-full rounded-poke-md bg-poke-accent text-poke-surface py-1.5 text-sm font-heading font-bold hover:opacity-90 transition-opacity"
                >
                  {t('tools.speed.compare')}
                </button>
                {speedResults.p1 !== null && (
                  <p className="text-xs text-poke-text-secondary">
                    {t('tools.speed.result', {
                      pokemon1: species1,
                      evs1: speedResults.p1,
                      pokemon2: species2,
                      evs2: speedResults.p2 ?? 0,
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-poke-text-secondary">{t('tools.speed.empty')}</p>
            )}
          </div>
        )}

        {activeTab === 'damage' && (
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-poke-text-primary">{t('tools.damage.title')}</h3>
            {pokemon1?.species && pokemon2?.species ? (
              <div className="space-y-2">
                <p className="text-xs text-poke-text-secondary">
                  {t('tools.damage.attacking', { attacker: species1, defender: species2 })}
                </p>
                <button
                  onClick={calcDamage}
                  disabled={calcLoading}
                  className="w-full rounded-poke-md bg-poke-accent text-poke-surface py-1.5 text-sm font-heading font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {calcLoading ? t('tools.damage.calculating') : t('tools.damage.calculateAll')}
                </button>
                {damageLines.length > 0 && (
                  <div className="space-y-1">
                    {damageLines.map((line, i) => (
                      <div key={i} className="text-sm text-poke-text-primary font-mono bg-poke-muted rounded px-2 py-1">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-poke-text-secondary">{t('tools.damage.empty')}</p>
            )}
          </div>
        )}

        {activeTab === 'field' && (
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-poke-text-primary">{t('tools.field.title')}</h3>
            <p className="text-sm text-poke-text-secondary">
              {t('tools.field.comingSoon')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
