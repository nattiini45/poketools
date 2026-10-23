/**
 * Double-elimination loss counts on the match cards (PR #65 test plan 1.1).
 *
 * A card prints each entrant's losses going INTO that match, not the
 * player's count today: printing today's count would label the Winners Final
 * loser "1 loss" on the Winners Final they entered unbeaten, and the Grand
 * Final winner from the losers side "1 loss" on every earlier card. The Grand
 * Final's 0 against 1 is what decides whether the reset is played; the reset
 * reads 1 against 1.
 *
 * The bracket is the engine's eight-player layout with four losers-side
 * starters (nominal loss on entry), played out to a bracket reset. Rendered
 * through react-dom/server; the feeder labels live in a module that imports
 * the Supabase query modules, so the client is a stub that throws on use.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('bracket render must not reach Supabase');
  },
}));

import ElimBracketView from '../ElimBracketView';
import { lossesEnteringMatches } from '../entry-losses';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { hubSharedLabels } from '@/lib/league-hub/copy';
import { renderWithI18n } from '@/test/i18n';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { MatchRecord } from '@/lib/tournament/types';
import type { BracketSide, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';

const T = 'tournament-losses';
const STAMP = '2026-01-01T00:00:00Z';

const PLAYERS: PublicTournamentParticipant[] = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({
  id: `p${seed}`,
  name: `Player ${seed}`,
  avatar_url: null,
  seed,
  starting_bracket: seed > 4 ? 'losers' : 'winners',
}));

const STRUCTURE = buildBracketStructureForParticipants('double_elim', PLAYERS)!;

const ROUNDS: Round[] = STRUCTURE.rounds.map((r) => ({
  id: `r${r.round_number}`,
  tournament_id: T,
  name: r.name,
  round_number: r.round_number,
  best_of: 3,
  status: 'active',
  pairings_generated: true,
  deadline: null,
  bracket_side: r.bracket_side,
  bye_player_ids: [],
  created_at: STAMP,
  updated_at: STAMP,
}));

function slotMatch(slotKey: string, p1: string, p2: string, winner: string | null): MatchWithPlayers {
  const slot = STRUCTURE.slots.find((s) => s.slotKey === slotKey);
  if (!slot) throw new Error(`no slot ${slotKey}`);
  return {
    id: `m-${slotKey}`,
    round_id: `r${slot.global_round_number}`,
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
    bracket_side: slot.bracket_side as BracketSide,
    bracket_pos: slot.bracket_pos,
    created_at: STAMP,
    updated_at: STAMP,
    player_1_name: p1,
    player_2_name: p2,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner,
    round_status: 'active',
    games: winner
      ? [{ id: `g-${slotKey}`, game_number: 1, winner_id: winner, replay_url: '', source: 'manual', stats_locked: false }]
      : [],
  };
}

function records(matches: MatchWithPlayers[]): MatchRecord[] {
  return matches
    .filter((m) => m.status === 'completed')
    .map((m) => ({ player_1_id: m.player_1_id, player_2_id: m.player_2_id, winner_id: m.winner_id, round_number: 0 }));
}

// The whole bracket up to the Grand Final. p2 loses the Winners Final to p1
// and meets p5 (a losers-side starter) in the Losers Final.
const BEFORE_GRAND_FINAL = [
  slotMatch('w-0-0', 'p1', 'p4', 'p1'),
  slotMatch('w-0-1', 'p2', 'p3', 'p2'),
  slotMatch('l-0-0', 'p5', 'p8', 'p5'),
  slotMatch('l-0-1', 'p6', 'p7', 'p6'),
  slotMatch('l-1-0', 'p5', 'p3', 'p5'),
  slotMatch('l-1-1', 'p6', 'p4', 'p6'),
  slotMatch('l-2-0', 'p5', 'p6', 'p5'),
  slotMatch('w-1-0', 'p1', 'p2', 'p1'),
  slotMatch('l-3-0', 'p5', 'p2', 'p5'),
];
// p5 wins the Grand Final, so the reset is played.
const PLAYED_TO_RESET = [
  ...BEFORE_GRAND_FINAL,
  slotMatch('gf-0-0', 'p1', 'p5', 'p5'),
  slotMatch('gf-0-1', 'p1', 'p5', null),
];

describe('lossesEnteringMatches', () => {
  const entry = lossesEnteringMatches(ROUNDS, PLAYED_TO_RESET, PLAYERS);

  it('reads 0 against 0 on the winners side', () => {
    expect(entry['m-w-0-0']).toEqual({ player1: 0, player2: 0 });
    expect(entry['m-w-1-0']).toEqual({ player1: 0, player2: 0 });
  });

  it('gives losers-side starters their nominal loss from their first match', () => {
    expect(entry['m-l-0-0']).toEqual({ player1: 1, player2: 1 });
    expect(entry['m-l-0-1']).toEqual({ player1: 1, player2: 1 });
  });

  it('counts a winners-side loss only on the matches after it', () => {
    // p2 entered the Winners Final unbeaten and the Losers Final with one loss.
    expect(entry['m-w-1-0'].player2).toBe(0);
    expect(entry['m-l-3-0']).toEqual({ player1: 1, player2: 1 });
    // p3 dropped from the semifinal into Losers Round 2.
    expect(entry['m-l-1-0']).toEqual({ player1: 1, player2: 1 });
  });

  it('reads 0 against 1 on the Grand Final and 1 against 1 on the reset', () => {
    expect(entry['m-gf-0-0']).toEqual({ player1: 0, player2: 1 });
    expect(entry['m-gf-0-1']).toEqual({ player1: 1, player2: 1 });
  });

  it('never counts a match result towards its own entry, and ignores unfinished matches', () => {
    // The Grand Final is completed (p1 lost it) and still reads p1 = 0.
    expect(entry['m-gf-0-0'].player1).toBe(0);
    const open = lossesEnteringMatches(
      ROUNDS,
      [slotMatch('w-1-0', 'p1', 'p2', null), slotMatch('l-3-0', 'p5', 'p2', null)],
      PLAYERS,
    );
    expect(open['m-l-3-0']).toEqual({ player1: 1, player2: 0 });
  });

  it('orders by round, not by the order the rows came in', () => {
    const shuffled = lossesEnteringMatches(ROUNDS, [...PLAYED_TO_RESET].reverse(), PLAYERS);
    expect(shuffled).toEqual(entry);
  });
});

function view(matches: MatchWithPlayers[], bracketType: 'single_elim' | 'double_elim' = 'double_elim', german = false) {
  return renderToStaticMarkup(
    <ElimBracketView
      bracketType={bracketType}
      tournamentId={T}
      rounds={ROUNDS}
      matches={matches}
      participants={PLAYERS}
      matchRecords={records(matches)}
      copy={german ? hubSharedLabels('de')?.bracket : undefined}
    />,
  );
}

/** One match card's markup (the link to its detail page). */
function card(html: string, matchId: string): string {
  const start = html.indexOf(`href="/tournaments/${T}/matches/${matchId}"`);
  if (start < 0) throw new Error(`no card for ${matchId}`);
  return html.slice(start, html.indexOf('</a>', start));
}

/** The loss marks on a card, player 1 first. */
function marks(html: string, matchId: string): number[] {
  return [...card(html, matchId).matchAll(/data-entry-losses="(\d+)"/g)].map((m) => Number(m[1]));
}

describe('ElimBracketView — loss counts on double elimination cards', () => {
  const html = view(PLAYED_TO_RESET);

  it('prints the losses each entrant brought into the match on every card', () => {
    expect(marks(html, 'm-w-1-0')).toEqual([0, 0]);
    expect(marks(html, 'm-l-3-0')).toEqual([1, 1]);
    expect(marks(html, 'm-gf-0-0')).toEqual([0, 1]);
    expect(marks(html, 'm-gf-0-1')).toEqual([1, 1]);
  });

  it('labels the marks in English: a short mark and the spelled-out meaning', () => {
    const gf = card(html, 'm-gf-0-0');
    expect(gf).toContain('1 L');
    expect(gf).toContain('Losses before this match: 1');
    expect(gf).toContain('title="Losses before this match: 0"');
  });

  it('labels them in German on the plaza', () => {
    const gf = card(view(PLAYED_TO_RESET, 'double_elim', true), 'm-gf-0-0');
    expect(gf).toContain('1 N');
    expect(gf).toContain('Niederlagen vor diesem Spiel: 1');
    expect(gf).not.toContain('Losses before');
  });

  it("labels them in the viewer's language without a copy override", () => {
    const html = renderWithI18n(
      <ElimBracketView
        bracketType="double_elim"
        tournamentId={T}
        rounds={ROUNDS}
        matches={PLAYED_TO_RESET}
        participants={PLAYERS}
        matchRecords={records(PLAYED_TO_RESET)}
      />,
      { locale: 'de' },
    );
    const gf = card(html, 'm-gf-0-0');
    expect(gf).toContain('1 N');
    expect(gf).toContain('title="Niederlagen vor diesem Spiel: 0"');
    expect(gf).not.toContain('Losses before');
  });

  it('prints no loss marks on single elimination cards', () => {
    const single = view([slotMatch('w-0-0', 'p1', 'p4', 'p1')], 'single_elim');
    expect(single).toContain(`/matches/m-w-0-0"`);
    expect(single).not.toContain('data-entry-losses');
    expect(single).not.toContain('Losses before');
  });
});
