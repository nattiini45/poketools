/**
 * Legacy draft board parts in English and German (draft-frontend §8.3, §8.5):
 * KOs are only `real_kills`; total progress is labelled progress; German copy
 * and German species names render under `locale: 'de'`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

// DraftPoolManager refreshes the page after a create; no app router is mounted here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import EvolutionRosterCard from '../EvolutionRosterCard';
import EvolutionEventBanner from '../EvolutionEventBanner';
import TierListDisplay from '../TierListDisplay';
import DraftPoolManager from '../DraftPoolManager';
import type { EvolutionTier, EvolutionTrackerWithTier } from '@/types/evolution';

const tier: EvolutionTier = {
  id: 'tier-1',
  season_id: 'season-1',
  player_id: null,
  base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon',
  stage2_kos: 5,
  stage3_pokemon: 'Charizard',
  stage3_kos: 6,
  power_tier: 'A',
  created_at: '2026-10-01T00:00:00.000Z',
};

const tracker: EvolutionTrackerWithTier = {
  id: 'tracker-1',
  season_id: 'season-1',
  player_id: 'p1',
  base_pokemon: 'Charmander',
  current_form: 'Charmander',
  total_kos: 4,
  current_stage: 1,
  evolved_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  real_kills: 1,
  draft_tokens: 2,
  kill_tokens: 1,
  cosmo_points: 0,
  suspended_until_matchday: null,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
  line_id: null,
  transferred_evo_progress: 0,
  redraft_slot_id: null,
  tier,
};

const card = (
  <EvolutionRosterCard
    playerName="Ash"
    trackers={[tracker]}
    regularPokemon={[]}
    budget={10}
    isCurrentPicker={false}
    picksRemaining={1}
  />
);

describe('EvolutionRosterCard (§8.3)', () => {
  it('labels only real kills as KOs and shows the other sources as chips', () => {
    const html = renderToStaticMarkup(card);
    expect(html).toContain('1 KO');
    expect(html).not.toContain('4 KOs');
    expect(html).toContain('+2 Draft Kill Tokens');
    expect(html).toContain('+1 Comeback');
    expect(html).toContain('1 progress to Charmeleon');
    expect(html).toContain('10 pts remaining');
    expect(html).toContain('1 pick left');
  });

  it('renders German copy and species names', () => {
    const html = renderWithI18n(card, { locale: 'de' });
    expect(html).toContain('noch 1 Fortschrittspunkt bis Glutexo');
    expect(html).toContain('+2 Draft-Kill-Tokens');
    expect(html).toContain('10 Pkt. übrig');
    expect(html).toContain('Glumanda');
  });
});

describe('EvolutionEventBanner (§8.3)', () => {
  const banner = (
    <EvolutionEventBanner
      playerNames={{ p1: 'Ash' }}
      events={[
        {
          player_id: 'p1',
          base_pokemon: 'Charmander',
          previous_form: 'Charmander',
          new_form: 'Charmeleon',
          new_stage: 2,
          total_kos: 5,
          is_devolution: false,
        },
      ]}
    />
  );

  it('labels the total as progress, never KOs', () => {
    const html = renderToStaticMarkup(banner);
    expect(html).toContain('(progress 5)');
    expect(html).not.toContain('KOs');
    expect(html).toContain('<strong>Ash</strong>');
  });

  it('renders German', () => {
    const html = renderWithI18n(banner, { locale: 'de' });
    expect(html).toContain('Entwickelt!');
    expect(html).toContain('Glumanda von <strong>Ash</strong> hat sich zu <strong>Glutexo</strong> entwickelt (Fortschritt 5)');
  });
});

describe('TierListDisplay', () => {
  it('renders limits and German species names', () => {
    const element = (
      <TierListDisplay
        tiers={[tier]}
        tierLimits={[{ id: 'l1', season_id: 'season-1', power_tier: 'A', max_picks: 2 }]}
      />
    );
    expect(renderToStaticMarkup(element)).toContain('1 available · max 2 per player');
    const de = renderWithI18n(element, { locale: 'de' });
    expect(de).toContain('1 verfügbar · max. 2 pro Spieler');
    expect(de).toContain('→ Glurak (6 KOs)');
  });
});

describe('DraftPoolManager', () => {
  it('renders English verbatim and German', () => {
    const element = <DraftPoolManager seasonId="s1" seasonName="Season 3" />;
    const en = renderToStaticMarkup(element);
    expect(en).toContain('Create Draft Pool');
    expect(en).toContain('Set up a draft for <strong>Season 3</strong>');
    const de = renderWithI18n(element, { locale: 'de' });
    expect(de).toContain('Draft-Pool erstellen');
    expect(de).toContain('Feste Preise');
    expect(de).toContain('Gleiche Reihenfolge');
  });
});
