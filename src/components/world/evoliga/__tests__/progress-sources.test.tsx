/**
 * T19: draft-frontend §8.3 on the world DOM surfaces. The only number
 * labelled KOs is a line's self-earned kills (`real_kills`); transferred
 * progress and the three tokens are their own chips; lines order by stage,
 * then self-earned KOs, then total progress (`compareTrackersForDisplay`).
 * A team's KO total is the sum of `real_kills`, never of `total_kos`.
 *
 * Rendered with react-dom/server (vitest `node`), in both languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) {
    return createElement('a', { ...rest, href }, children);
  }
  return { default: Link };
});

import EvoligaTeamsSection from '../TeamsSection';
import TeamFocusPanel from '../TeamFocusPanel';
import TeamPanel from '@/components/world/sections/overlays/TeamPanel';
import type { EvolutionTracker } from '@/types/evolution';
import type { PublicParticipant } from '@/lib/players/public-player';

function tracker(overrides: Partial<EvolutionTracker>): EvolutionTracker {
  return {
    id: 'tracker',
    season_id: 'season',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmander',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

const PARTICIPANT = { id: 'p1', name: 'Mara', gym_type: null } as unknown as PublicParticipant;

/** 2 own KOs + 1 Draft Kill Token + 1 Comeback Token = 4 progress (the merged `total_kos`). */
const BOOSTED = tracker({
  id: 'boosted',
  base_pokemon: 'Charmander',
  current_form: 'Charmander',
  real_kills: 2,
  draft_tokens: 1,
  kill_tokens: 1,
  total_kos: 4,
});
/** 3 own KOs, nothing else: fewer total progress but more self-earned kills. */
const EARNED = tracker({
  id: 'earned',
  base_pokemon: 'Bulbasaur',
  current_form: 'Bulbasaur',
  real_kills: 3,
  total_kos: 3,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('plaza #teams (EvoLiga TeamsSection)', () => {
  const render = (locale: 'de' | 'en') =>
    text(
      renderToStaticMarkup(
        <EvoligaTeamsSection participants={[PARTICIPANT]} trackers={[BOOSTED]} entries={[]} locale={locale} />,
      ),
    );

  it('labels only self-earned kills as KOs, the tokens as their own chips (English)', () => {
    const body = render('en');
    expect(body).toContain('Stage 1 · 2 KOs');
    expect(body).toContain('+1 Draft Kill Token');
    expect(body).toContain('+1 Comeback');
    expect(body).not.toContain('4 KOs');
  });

  it('German: Stufe, KOs and the glossary token names, Pokémon names from the pkmn layer', () => {
    const body = render('de');
    expect(body).toContain('Glumanda');
    expect(body).toContain('Stufe 1 · 2 KOs');
    expect(body).toContain('+1 Draft-Kill-Token');
    expect(body).not.toContain('4 KOs');
  });
});

describe('plaza ?team= panel (TeamFocusPanel)', () => {
  const render = (locale: 'de' | 'en') =>
    renderToStaticMarkup(
      <TeamFocusPanel
        participant={PARTICIPANT}
        lines={[BOOSTED, EARNED]}
        entryByBase={new Map()}
        standing={null}
        locale={locale}
      />,
    );

  it('sums real kills only for the team KO total (5, never the merged 7)', () => {
    const body = text(render('en'));
    expect(body).toContain('Total KOs 5');
    expect(body).not.toContain('Total KOs 7');
    expect(text(render('de'))).toContain('KOs gesamt 5');
  });

  it('orders the party by stage, then self-earned KOs: 3 own KOs before 2 + tokens', () => {
    const html = render('en');
    expect(html.indexOf('Bulbasaur')).toBeLessThan(html.indexOf('Charmander'));
  });
});

describe('isle ?team= panel (shared TeamPanel)', () => {
  const render = (locale: 'de' | 'en') =>
    renderToStaticMarkup(
      <TeamPanel
        participant={PARTICIPANT}
        standing={null}
        rank={null}
        ace="Bulbasaur"
        lines={[BOOSTED, EARNED]}
        entryByBase={new Map()}
        locale={locale}
      />,
    );

  it('shows each line’s own KOs with source chips and sorts by self-earned KOs', () => {
    const html = render('en');
    const body = text(html);
    expect(body).toContain('Stage 1 · 2 KOs');
    expect(body).toContain('Stage 1 · 3 KOs');
    expect(body).not.toContain('4 KOs');
    expect(html.indexOf('Bulbasaur', html.indexOf('Drafted lines'))).toBeLessThan(
      html.indexOf('Charmander', html.indexOf('Drafted lines')),
    );
  });

  it('German chrome and species names for a German viewer', () => {
    const body = text(render('de'));
    expect(body).toContain('Gedraftete Linien');
    expect(body).toContain('Bisasam');
    expect(body).toContain('Stufe 1 · 2 KOs');
  });
});
