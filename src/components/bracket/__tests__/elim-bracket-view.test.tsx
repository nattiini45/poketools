/**
 * ElimBracketView: the elimination bracket prep (slot skeleton, feeder
 * labels, double-elim loss counts, legacy fallback) extracted from the
 * tournament page so the phase page and the league hub's playoff tab draw
 * the same bracket.
 *
 * The extraction must not change the phase page: every case below renders
 * the view and the renderer it wraps, fed the way the tournament page fed it
 * inline before the extraction, and compares the markup. A few direct checks
 * pin what the prep contributes (feeder labels, loss counts, legacy mode).
 *
 * Rendered through react-dom/server (vitest 'node' env). The feeder labels
 * live in a module that imports the Supabase query modules, so the Supabase
 * client is a stub that throws on use: nothing here reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('bracket render must not reach Supabase');
  },
}));

import ElimBracketView from '../ElimBracketView';
import { renderWithI18n } from '@/test/i18n';
import SingleElimBracket from '../SingleElimBracket';
import DoubleElimBracket from '../DoubleElimBracket';
import { isLegacyElimBracketData } from '../legacy';
import { lossesEnteringMatches } from '../entry-losses';
import { buildBracketStructureForParticipants, buildSlotIndexMap } from '@/lib/tournament/bracket-structure';
import { getBracketSlotLabels } from '@/lib/tournament/bracket-propagation';
import { computeBracketState, startingBracketsFromParticipants } from '@/lib/tournament/double-elim';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { MatchRecord } from '@/lib/tournament/types';
import type { BracketSide, GameSummary, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';

const T = 'tournament-1';
const STAMP = '2026-01-01T00:00:00Z';
const NAMES: Record<string, string> = { p1: 'Ash', p2: 'Brock', p3: 'Misty', p4: 'Gary' };

function participant(id: string, seed: number, starting: 'winners' | 'losers' = 'winners'): PublicTournamentParticipant {
  return { id, name: NAMES[id], avatar_url: null, seed, starting_bracket: starting };
}

const FOUR = [participant('p1', 1), participant('p2', 2), participant('p3', 3), participant('p4', 4)];

function round(id: string, name: string, roundNumber: number, side: BracketSide | null): Round {
  return {
    id,
    tournament_id: T,
    name,
    round_number: roundNumber,
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: side,
    bye_player_ids: [],
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function game(number: number, winner: string): GameSummary {
  return { id: `g-${number}-${winner}`, game_number: number, winner_id: winner, replay_url: '', source: 'manual', stats_locked: false };
}

function match(
  id: string,
  roundId: string,
  p1: string,
  p2: string,
  options: { winner?: string; pos?: number | null; side?: BracketSide | null } = {},
): MatchWithPlayers {
  const winner = options.winner ?? null;
  return {
    id,
    round_id: roundId,
    tournament_id: T,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status: winner ? 'completed' : 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: options.side ?? null,
    bracket_pos: options.pos ?? null,
    created_at: STAMP,
    updated_at: STAMP,
    player_1_name: NAMES[p1],
    player_2_name: NAMES[p2],
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner ? NAMES[winner] : null,
    round_status: 'active',
    games: winner ? [game(1, winner), game(2, winner)] : [],
  };
}

function records(matches: MatchWithPlayers[], rounds: Round[]): MatchRecord[] {
  const numberOf = new Map(rounds.map((r) => [r.id, r.round_number]));
  return matches
    .filter((m) => m.status === 'completed')
    .map((m) => ({
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      round_number: numberOf.get(m.round_id) ?? 0,
    }));
}

/**
 * The tournament page's inline bracket prep before the extraction, verbatim
 * in substance. One addition since: double elimination cards print each
 * entrant's losses going into the match (PR #65 test plan 1.1, pinned in
 * entry-losses.test.tsx), so the double elimination render passes them too.
 */
function legacyPageMarkup(
  bracketType: 'single_elim' | 'double_elim',
  rounds: Round[],
  matches: MatchWithPlayers[],
  participants: PublicTournamentParticipant[],
  matchRecords: MatchRecord[],
): string {
  const matchesByRound: Record<string, MatchWithPlayers[]> = {};
  for (const m of matches) {
    if (!matchesByRound[m.round_id]) matchesByRound[m.round_id] = [];
    matchesByRound[m.round_id].push(m);
  }
  const participantIds = participants.map((p) => p.id);
  const isLegacyElim = isLegacyElimBracketData(rounds, matches);
  const elimStructure = !isLegacyElim ? buildBracketStructureForParticipants(bracketType, participants) : null;
  const slotIndexByKey = elimStructure ? buildSlotIndexMap(elimStructure.slots) : undefined;
  const slotLabels = elimStructure ? getBracketSlotLabels(elimStructure) : undefined;
  if (bracketType === 'single_elim') {
    return renderToStaticMarkup(
      <SingleElimBracket
        rounds={rounds}
        matchesByRound={matchesByRound}
        tournamentId={T}
        structureSlots={elimStructure?.slots}
        slotLabels={slotLabels}
        slotIndexByKey={slotIndexByKey}
        legacyMode={isLegacyElim}
      />,
    );
  }
  const bracketState = computeBracketState(participantIds, matchRecords, startingBracketsFromParticipants(participants));
  const lossCount: Record<string, number> = {};
  for (const pid of participantIds) {
    if (bracketState.winners_bracket.includes(pid)) lossCount[pid] = 0;
    else if (bracketState.losers_bracket.includes(pid)) lossCount[pid] = 1;
    else lossCount[pid] = 2;
  }
  return renderToStaticMarkup(
    <DoubleElimBracket
      rounds={rounds}
      matchesByRound={matchesByRound}
      tournamentId={T}
      structureSlots={elimStructure?.slots}
      slotLabels={slotLabels}
      slotIndexByKey={slotIndexByKey}
      legacyMode={isLegacyElim}
      lossCount={lossCount}
      entryLosses={lossesEnteringMatches(rounds, matches, participants)}
    />,
  );
}

function view(
  bracketType: 'single_elim' | 'double_elim',
  rounds: Round[],
  matches: MatchWithPlayers[],
  participants: PublicTournamentParticipant[],
  matchRecords: MatchRecord[],
): string {
  return renderToStaticMarkup(
    <ElimBracketView
      bracketType={bracketType}
      tournamentId={T}
      rounds={rounds}
      matches={matches}
      participants={participants}
      matchRecords={matchRecords}
    />,
  );
}

// ─── Scenarios ────────────────────────────────────────────────────────────

const SE_ROUNDS = [round('se-r2', 'Finals', 2, 'winners'), round('se-r1', 'Semifinals', 1, 'winners')];
const SE_MATCHES = [
  match('se-m1', 'se-r1', 'p1', 'p4', { winner: 'p1', pos: 0, side: 'winners' }),
  match('se-m2', 'se-r1', 'p2', 'p3', { pos: 1, side: 'winners' }),
];

// Legacy rows: no bracket side on the rounds, no bracket position on the matches.
const LEGACY_SE_ROUNDS = [round('l-r1', 'Round 1', 1, null), round('l-r2', 'Round 2', 2, null)];
const LEGACY_SE_MATCHES = [
  match('l-m1', 'l-r1', 'p1', 'p4', { winner: 'p1' }),
  match('l-m2', 'l-r1', 'p2', 'p3', { winner: 'p2' }),
  match('l-m3', 'l-r2', 'p1', 'p2'),
];

const DE_ROUNDS = [
  round('de-w1', 'Winners Round 1', 1, 'winners'),
  round('de-l1', 'Losers Round 1', 2, 'losers'),
  round('de-gf', 'Grand Finals', 5, 'grand_finals'),
];
const DE_MATCHES = [
  match('de-m1', 'de-w1', 'p1', 'p4', { winner: 'p1', pos: 0, side: 'winners' }),
  match('de-m2', 'de-w1', 'p2', 'p3', { winner: 'p3', pos: 1, side: 'winners' }),
];

// Legacy double elimination: the side of each round is inferred from loss counts.
const LEGACY_DE_ROUNDS = [round('ld-r1', 'Round 1', 1, null), round('ld-r2', 'Round 2', 2, null), round('ld-r3', 'Round 3', 3, null)];
const LEGACY_DE_MATCHES = [
  match('ld-m1', 'ld-r1', 'p1', 'p2', { winner: 'p1' }),
  match('ld-m2', 'ld-r1', 'p3', 'p4', { winner: 'p3' }),
  match('ld-m3', 'ld-r2', 'p1', 'p3'),
  match('ld-m4', 'ld-r3', 'p2', 'p4'),
];

describe('ElimBracketView matches the phase page bracket it replaced', () => {
  const cases = [
    ['single elimination', 'single_elim', SE_ROUNDS, SE_MATCHES, FOUR],
    ['single elimination, no rounds yet', 'single_elim', [], [], FOUR],
    ['legacy single elimination', 'single_elim', LEGACY_SE_ROUNDS, LEGACY_SE_MATCHES, FOUR],
    ['double elimination', 'double_elim', DE_ROUNDS, DE_MATCHES, FOUR],
    [
      'double elimination with a losers-side starter',
      'double_elim',
      DE_ROUNDS,
      DE_MATCHES,
      [participant('p1', 1), participant('p2', 2), participant('p3', 3), participant('p4', 4, 'losers')],
    ],
    ['legacy double elimination', 'double_elim', LEGACY_DE_ROUNDS, LEGACY_DE_MATCHES, FOUR],
  ] as const;

  it.each(cases)('%s', (_label, type, rounds, matches, participants) => {
    const matchRecords = records([...matches], [...rounds]);
    expect(view(type, [...rounds], [...matches], [...participants], matchRecords)).toBe(
      legacyPageMarkup(type, [...rounds], [...matches], [...participants], matchRecords),
    );
  });
});

describe('ElimBracketView', () => {
  it('draws a single elimination bracket with slot skeletons fed by the earlier round', () => {
    const html = view('single_elim', SE_ROUNDS, SE_MATCHES, FOUR, records(SE_MATCHES, SE_ROUNDS));
    // Rounds in round order, whatever order the rows came in.
    expect(html.indexOf('>Semifinals<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Finals<')).toBeGreaterThan(html.indexOf('>Semifinals<'));
    expect(html).toContain(`href="/tournaments/${T}/matches/se-m1"`);
    expect(html).toContain(`href="/tournaments/${T}/matches/se-m2"`);
    expect(html).toContain('Winner of M1');
    expect(html).toContain('Winner of M2');
    expect(html).toContain('aria-label="Match 3 TBD"');
  });

  it('falls back to flat per-round cards for legacy rows (no skeletons, no feeder labels)', () => {
    const html = view('single_elim', LEGACY_SE_ROUNDS, LEGACY_SE_MATCHES, FOUR, records(LEGACY_SE_MATCHES, LEGACY_SE_ROUNDS));
    for (const id of ['l-m1', 'l-m2', 'l-m3']) expect(html).toContain(`/matches/${id}"`);
    expect(html).not.toContain('Winner of');
    expect(html).not.toContain('TBD');
  });

  it('splits a double elimination bracket by side, with losers-side feeder labels', () => {
    const html = view('double_elim', DE_ROUNDS, DE_MATCHES, FOUR, records(DE_MATCHES, DE_ROUNDS));
    expect(html).toContain('Winners Bracket');
    expect(html).toContain('Losers Bracket');
    expect(html).toContain('Grand Finals');
    expect(html).toContain('Loser of M1');
    expect(html).toContain('Loser of M2');
  });

  it('places legacy double elimination rounds from the loss counts of the completed results', () => {
    const withResults = view(
      'double_elim',
      LEGACY_DE_ROUNDS,
      LEGACY_DE_MATCHES,
      FOUR,
      records(LEGACY_DE_MATCHES, LEGACY_DE_ROUNDS),
    );
    // Round 3 (both players have lost once) is a losers round.
    expect(withResults).toContain('Losers Bracket');
    // Without results nobody has lost, so nothing is on the losers side.
    const withoutResults = view('double_elim', LEGACY_DE_ROUNDS, LEGACY_DE_MATCHES, FOUR, []);
    expect(withoutResults).not.toContain('Losers Bracket');
  });

  it('says no rounds are generated when the phase has none', () => {
    expect(view('single_elim', [], [], FOUR, [])).toContain('No rounds generated yet.');
    expect(view('double_elim', [], [], FOUR, [])).toContain('No rounds generated yet.');
  });
});

describe('ElimBracketView — German viewer', () => {
  it('shows the stored English round names and feeder labels in German', () => {
    const html = renderWithI18n(
      <ElimBracketView
        bracketType="single_elim"
        tournamentId={T}
        rounds={SE_ROUNDS}
        matches={SE_MATCHES}
        participants={FOUR}
        matchRecords={records(SE_MATCHES, SE_ROUNDS)}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('>Halbfinale<');
    expect(html).toContain('>Finale<');
    expect(html).toContain('Sieger aus M1');
    expect(html).toContain('aria-label="Spiel 3 Offen"');
    expect(html).not.toContain('Winner of');
    expect(html).not.toContain('>Semifinals<');
  });

  it('says no rounds are generated in German', () => {
    const html = renderWithI18n(
      <ElimBracketView
        bracketType="double_elim"
        tournamentId={T}
        rounds={[]}
        matches={[]}
        participants={FOUR}
        matchRecords={[]}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('Noch keine Runden angelegt.');
  });
});
