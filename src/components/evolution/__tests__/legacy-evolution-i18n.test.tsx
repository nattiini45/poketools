/**
 * Evolution components in English and German (draft-frontend §8.3, §8.5):
 * spec token names (Draft Kill / Comeback / Cosmo Token), KOs only for real
 * kills, thresholds read from data, German workbook prose marked lang="de".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { epbPack, formatPack, teraEligibilityForStage } from '@/lib/format-pack';
import exampleList from '@/lib/draft/__tests__/fixtures/example-list.json';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { PRICE_GROUP_RANGES } from '@/lib/evolution/point-buy-display';
import MatchupRosterPanel from '../MatchupRosterPanel';
import MatchEvolutionSummary from '../MatchEvolutionSummary';
import EpbPokemonRow from '../EpbPokemonRow';
import PointBuyDetailCard from '../PointBuyDetailCard';
import MatchupPokemonDetail from '../MatchupPokemonDetail';
import type { EvolutionTracker, MatchEvolutionSnapshot } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';

/** Old abbreviations and names the spec retired (§8.3 token-naming guard). */
const RETIRED = /\bKill ?Token\b|Killtoken|Cosmo-Punkte|Cosmo Points|\bCP:|\bDT\b|\bKT\b/;

const tracker: EvolutionTracker = {
  id: 'tracker-1',
  season_id: 'season-1',
  player_id: 'p1',
  base_pokemon: 'Charmander',
  current_form: 'Charmeleon',
  total_kos: 9,
  current_stage: 2,
  evolved_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  real_kills: 4,
  draft_tokens: 2,
  kill_tokens: 1,
  cosmo_points: 2,
  suspended_until_matchday: null,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
  line_id: null,
  transferred_evo_progress: 0,
  redraft_slot_id: null,
};

const snapshot: MatchEvolutionSnapshot = {
  id: 'snap-1',
  match_id: 'm1',
  player_id: 'p1',
  tracker_id: 'tracker-1',
  base_pokemon: 'Charmander',
  species_at_match: 'Charmander',
  stage_at_match: 1,
  progress_before: 2,
  progress_after: 5,
  real_kos: 2,
  draft_tokens_delta: 0,
  kill_tokens_delta: 1,
  cosmo_points_delta: 0,
  evolution_triggered: true,
  suspension_triggered: false,
  brought: true,
  created_at: '2026-10-01T00:00:00.000Z',
};

describe('MatchupRosterPanel (§8.3)', () => {
  const panel = (
    <MatchupRosterPanel
      name="Ash"
      trackers={[tracker]}
      typeInfo={{}}
      priceByBase={{ Charmander: 18 }}
      roles={[]}
      bannedSet={new Set()}
      onSelect={() => {}}
      selected={null}
    />
  );

  it('shows real kills as KOs and the other sources as spec-named chips', () => {
    const html = renderToStaticMarkup(panel);
    expect(html).toContain('Progress: 9');
    expect(html).toContain('4 KOs');
    expect(html).toContain('+2 Draft Kill Tokens');
    expect(html).toContain('+1 Comeback');
    expect(html).toContain(formatPack.messages.en.draftShared.progress.cosmoChip.replace('{n}', '2'));
    // The stage-2 Tera chip follows the active format pack's `teraByStage`.
    expect(html).toContain(draftLegacyMessages.en.tera[teraEligibilityForStage(2)]);
    expect(html).toContain('18 pts');
    expect(html).not.toMatch(RETIRED);
  });

  it('renders German', () => {
    const html = renderWithI18n(panel, { locale: 'de' });
    expect(html).toContain('Glutexo');
    expect(html).toContain('Fortschritt: 9');
    expect(html).toContain('1 Linie');
    expect(html).toContain(draftLegacyMessages.de.tera[teraEligibilityForStage(2)]);
  });
});

describe('MatchEvolutionSummary (§8.3)', () => {
  const summary = (
    <MatchEvolutionSummary
      playerName="Ash"
      snapshots={[snapshot]}
      evolutionPointEarned
      isWinner
      evolvedInto={{ 'snap-1': 'Charmeleon' }}
    />
  );

  it('names kill_tokens Comeback Token', () => {
    const html = renderToStaticMarkup(summary);
    expect(html).toContain('+1 Comeback Token');
    expect(html).toContain('1 evolution');
    expect(html).not.toMatch(RETIRED);
  });

  it('renders German', () => {
    const html = renderWithI18n(summary, { locale: 'de' });
    expect(html).toContain('+1 Comeback-Token');
    expect(html).toContain('1 Entwicklung');
    expect(html).toContain('Glutexo');
  });
});

describe('EpbPokemonRow', () => {
  const row = <EpbPokemonRow snapshot={snapshot} nextStageRequirement={5} nextForm="Charmeleon" price={18} />;

  it('uses the spec chip names for per-match deltas', () => {
    const html = renderToStaticMarkup(row);
    expect(html).toContain('2 KOs');
    expect(html).toContain('+1 Comeback');
    expect(html).toContain('Evolved into Charmeleon');
    expect(html).not.toMatch(RETIRED);
  });

  it('renders German', () => {
    const html = renderWithI18n(row, { locale: 'de' });
    expect(html).toContain('Entwickelt zu Glutexo');
    expect(html).toContain('18 Pkt.');
  });
});

describe('PointBuyDetailCard (§8.5)', () => {
  // The active format pack's override line (the example pack's participation line), with its override thresholds.
  const OVERRIDE = epbPack.lineOverrides[0];
  const OV = exampleList.entries.find((e) => e.line_id === OVERRIDE.line_id)!;
  const S2 = String(OVERRIDE.kills_to_stage2);
  const S3 = String(OVERRIDE.additional_kills_to_stage3);
  const cosmog: PointBuyListEntry = {
    id: 'e1',
    list_version_id: 'v1',
    line_number: 42,
    line_id: OVERRIDE.line_id,
    base_pokemon: OV.base_pokemon,
    stage2_pokemon: OV.stage2_pokemon,
    stage3_pokemon: OV.stage3_pokemon,
    price: epbPack.priceGroups.premium[1],
    kills_to_stage2: OVERRIDE.kills_to_stage2!,
    additional_kills_to_stage3: OVERRIDE.additional_kills_to_stage3!,
    price_group: 'premium',
    early_rating: 1,
    mid_rating: 2,
    late_rating: 5,
    rationale: 'Sehr stark im Endgame.',
    historical_data: null,
    special_rules: { cosmog: true, no_redraft: true },
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
  };
  const card = (
    <PointBuyDetailCard entry={cosmog} typesBySpecies={{}} rolesBySpecies={{}} bannedMoves={[]} onClose={() => {}} />
  );

  it('reads the thresholds from the entry and uses the spec token name', () => {
    const html = renderToStaticMarkup(card);
    // The participation-line rule text comes from the active format pack.
    expect(html).toContain(formatPack.messages.en.draftLegacyEvolution.pointBuy.rule.cosmog.replace('{s2}', S2).replace('{s3}', S3));
    expect(html).toContain('Excluded from the Redraft');
    const [min, max] = PRICE_GROUP_RANGES.premium;
    expect(html).toContain(`${formatPack.messages.en.enums.priceGroup.premium} (${min}–${max})`);
    expect(html).toContain('Line #42');
    expect(html).not.toMatch(RETIRED);
  });

  it('keeps the German workbook prose German, marked lang="de"', () => {
    const html = renderToStaticMarkup(card);
    expect(html).toContain('<h3 class="text-xs font-semibold text-poke-text-secondary">Rationale</h3>');
    expect(html).toContain('<p lang="de" class="mt-1 text-sm text-poke-text">Sehr stark im Endgame.</p>');
  });

  it('renders German', () => {
    const html = renderWithI18n(card, { locale: 'de' });
    expect(html).toContain(formatPack.messages.de.draftLegacyEvolution.pointBuy.rule.cosmog.replace('{s2}', S2).replace('{s3}', S3));
    expect(html).toContain('Begründung');
    expect(html).toContain('Stufe 1');
    expect(html).toContain('Tera: alle');
    expect(html).not.toMatch(RETIRED);
  });
});

describe('MatchupPokemonDetail', () => {
  it('localizes stats, abilities, types and team roles', () => {
    const html = renderWithI18n(
      <MatchupPokemonDetail
        detail={{
          species: 'Charizard',
          types: ['Fire', 'Flying'],
          weaknesses: ['Water'],
          resistances: ['Grass'],
          immunities: ['Ground'],
          baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 },
          abilities: ['Blaze'],
        }}
        roles={[
          {
            id: 'r1',
            species_form: 'Charizard',
            stage: 3,
            category: 'hazard_removal',
            move_name: 'Defog',
            source: null,
            is_active: true,
            created_at: '2026-10-01T00:00:00.000Z',
          },
        ]}
        onClose={() => {}}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('Glurak');
    expect(html).toContain('Fähigkeiten: Großbrand');
    expect(html).toContain('Wasser');
    expect(html).toContain('Hazards entfernen: Auflockern');
    expect(html).toContain('KP');
  });
});
