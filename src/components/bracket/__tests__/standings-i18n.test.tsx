/**
 * The phase standings tables and the round robin results grid print their
 * words from the `bracket` namespace in the viewer's language. English stays
 * the wording these tables always showed; an explicit `labels` override on
 * the grid still wins. Rendered through react-dom/server (vitest 'node' env).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupStandingsTable from '../GroupStandingsTable';
import SwissStandings from '../SwissStandings';
import RoundRobinTable from '../RoundRobinTable';
import { renderWithI18n } from '@/test/i18n';
import type { Standing } from '@/lib/tournament/types';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';
import type { PublicMatch } from '@/lib/match/public-match';

function standing(id: string, name: string, points: number): Standing {
  return {
    player_id: id,
    player_name: name,
    player_avatar_url: null,
    gym_type: null,
    wins: points / 3,
    losses: 0,
    draws: 0,
    points,
    games_played: 2,
    kill_differential: 3,
    buchholz: 0,
  } as Standing;
}

const STANDINGS = [standing('p1', 'Anna', 6), standing('p2', 'Ben', 3)];

const TIED: EvolutionStanding = {
  ...standing('p3', 'Cleo', 3),
  evolution_points: 4,
  needs_decision_match: true,
} as EvolutionStanding;

const MATCH = {
  id: 'm1',
  round_id: 'r1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  winner_id: 'p1',
  status: 'completed',
} as PublicMatch;

const GRID_PLAYERS = [
  { id: 'p1', name: 'Anna' },
  { id: 'p2', name: 'Ben' },
];

describe('GroupStandingsTable', () => {
  it('keeps the English headers outside a language context', () => {
    const html = renderToStaticMarkup(<GroupStandingsTable standings={STANDINGS} />);
    for (const header of ['Player', 'Games', 'Pts', 'Kill Diff']) expect(html).toContain(header);
  });

  it('prints German headers and the tie marker for a German viewer', () => {
    const html = renderWithI18n(
      <GroupStandingsTable standings={[...STANDINGS, TIED]} showEvolutionColumns />,
      { locale: 'de' },
    );
    for (const header of ['Spieler', 'Spiele', 'Pkt.', 'Kill-Diff.', 'EP']) expect(html).toContain(header);
    expect(html).toContain('>Gleichstand<');
    expect(html).toContain('title="Ungelöster Gleichstand – Entscheidungsspiel nötig"');
    expect(html).not.toContain('Kill Diff');
    expect(html).not.toContain('>Tie<');
  });
});

describe('SwissStandings', () => {
  it('prints German headers for a German viewer', () => {
    const html = renderWithI18n(<SwissStandings standings={STANDINGS} />, { locale: 'de' });
    expect(html).toContain('Spieler');
    expect(html).toContain('Pkt.');
    expect(html).toContain('Buchholz');
    expect(html).not.toContain('Pts');
  });
});

describe('RoundRobinTable', () => {
  it('prints the English letters by default', () => {
    const html = renderToStaticMarkup(<RoundRobinTable participants={GRID_PLAYERS} matches={[MATCH]} />);
    expect(html).toContain('>Player<');
    expect(html).toContain('>W<');
    expect(html).toContain('>L<');
  });

  it('prints German letters for a German viewer', () => {
    const html = renderWithI18n(<RoundRobinTable participants={GRID_PLAYERS} matches={[MATCH]} />, {
      locale: 'de',
    });
    expect(html).toContain('>Spieler<');
    expect(html).toContain('>S<');
    expect(html).toContain('>N<');
    expect(html).not.toContain('>W<');
  });

  it('lets an explicit labels override win over the viewer language', () => {
    const html = renderWithI18n(
      <RoundRobinTable
        participants={GRID_PLAYERS}
        matches={[MATCH]}
        labels={{ player: 'Trainer', win: '+', loss: '-', draw: '=' }}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('>Trainer<');
    expect(html).toContain('>+<');
    expect(html).not.toContain('>Spieler<');
  });
});
