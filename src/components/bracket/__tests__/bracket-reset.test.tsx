/**
 * The double-elimination bracket reset ("Winner of M10 / Loser of M10 (if
 * necessary)") and the bracket in another language.
 *
 * The reset slot is only played when the losers-bracket entrant wins the
 * Grand Final. Once the winners-bracket entrant has won it, the slot never
 * fills, so the bracket drops its skeleton instead of showing it under a
 * finished bracket (found in a manual test pass on a finished league).
 *
 * The reset is a per-tournament setting (`tournaments.bracket_reset_enabled`,
 * default on); switched off, an empty reset slot is not drawn, but a reset
 * match that already exists is.
 *
 * The bracket uses the engine's eight-player layout with four losers-side
 * starters (reset slot M11). Rendered through
 * react-dom/server; the feeder labels live in a module that imports the
 * Supabase query modules, so the client is a stub that throws on use.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('bracket render must not reach Supabase');
  },
}));

import ElimBracketView from '../ElimBracketView';
import { unneededResetSlotKeys } from '../bracket-reset';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { hubSharedLabels } from '@/lib/league-hub/copy';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { MatchRecord } from '@/lib/tournament/types';
import type { BracketSide, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';

const T = 'tournament-de';
const STAMP = '2026-01-01T00:00:00Z';

const PLAYERS: PublicTournamentParticipant[] = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({
  id: `p${seed}`,
  name: `Player ${seed}`,
  avatar_url: null,
  seed,
  starting_bracket: seed > 4 ? 'losers' : 'winners',
}));

const STRUCTURE = buildBracketStructureForParticipants('double_elim', PLAYERS)!;

/** One round row per engine round, named as the engine names them. */
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
  created_at: STAMP,
  updated_at: STAMP,
}));

function slotMatch(
  slotKey: string,
  p1: string,
  p2: string,
  winner: string | null,
): MatchWithPlayers {
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

function view(matches: MatchWithPlayers[], german = false, bracketResetEnabled?: boolean): string {
  return renderToStaticMarkup(
    <ElimBracketView
      bracketType="double_elim"
      tournamentId={T}
      rounds={ROUNDS}
      matches={matches}
      participants={PLAYERS}
      matchRecords={records(matches)}
      copy={german ? hubSharedLabels('de')?.bracket : undefined}
      bracketResetEnabled={bracketResetEnabled}
    />,
  );
}

/** The bracket with no copy override, in the viewer's language (the provider's locale). */
function viewIn(locale: Locale, matches: MatchWithPlayers[]): string {
  return renderWithI18n(
    <ElimBracketView
      bracketType="double_elim"
      tournamentId={T}
      rounds={ROUNDS}
      matches={matches}
      participants={PLAYERS}
      matchRecords={records(matches)}
    />,
    { locale },
  );
}

// p1 wins the Winners Final against p2; p5 comes through the losers side.
const WINNERS_FINAL = slotMatch('w-1-0', 'p1', 'p2', 'p1');
const LOSERS_FINAL = slotMatch('l-3-0', 'p5', 'p2', 'p5');

describe('the engine layout this file relies on', () => {
  it('has a Grand Final fed by the Winners Final and a reset slot fed by the Grand Final', () => {
    const reset = STRUCTURE.slots.find((s) => s.isBracketReset);
    expect(reset?.slotKey).toBe('gf-0-1');
    expect(reset?.feeder1).toEqual({ kind: 'winner', slotKey: 'gf-0-0' });
    const gf = STRUCTURE.slots.find((s) => s.slotKey === 'gf-0-0');
    expect(gf?.feeder1).toEqual({ kind: 'winner', slotKey: 'w-1-0' });
  });
});

describe('unneededResetSlotKeys', () => {
  it('drops the reset once the winners-bracket entrant has won the Grand Final', () => {
    const gf = slotMatch('gf-0-0', 'p1', 'p5', 'p1');
    expect([...unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [WINNERS_FINAL, LOSERS_FINAL, gf])]).toEqual(['gf-0-1']);
  });

  it('keeps it when the losers-bracket entrant won, or the Grand Final is unplayed', () => {
    const lost = slotMatch('gf-0-0', 'p1', 'p5', 'p5');
    expect(unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [WINNERS_FINAL, LOSERS_FINAL, lost]).size).toBe(0);
    const open = slotMatch('gf-0-0', 'p1', 'p5', null);
    expect(unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [WINNERS_FINAL, LOSERS_FINAL, open]).size).toBe(0);
  });

  it('keeps it when the Winners Final has no match row to name the entrant', () => {
    const gf = slotMatch('gf-0-0', 'p1', 'p5', 'p1');
    expect(unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [LOSERS_FINAL, gf]).size).toBe(0);
  });

  it('with the reset switched off, drops an empty reset slot whatever the Grand Final did', () => {
    for (const winner of [null, 'p1', 'p5']) {
      const gf = slotMatch('gf-0-0', 'p1', 'p5', winner);
      expect([...unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [WINNERS_FINAL, LOSERS_FINAL, gf], false)]).toEqual([
        'gf-0-1',
      ]);
    }
  });

  it('with the reset switched off, keeps a slot that already holds a reset match', () => {
    const gf = slotMatch('gf-0-0', 'p1', 'p5', 'p5');
    const reset = slotMatch('gf-0-1', 'p5', 'p1', 'p5');
    expect(unneededResetSlotKeys(STRUCTURE.slots, ROUNDS, [WINNERS_FINAL, LOSERS_FINAL, gf, reset], false).size).toBe(0);
  });
});

describe('ElimBracketView — the bracket reset', () => {
  it('shows the "(if necessary)" reset skeleton while the Grand Final is open', () => {
    const html = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', null)]);
    expect(html).toContain('Loser of M10 (if necessary)');
    expect(html).toContain('aria-label="Match 11 TBD"');
  });

  it('drops the reset skeleton once the winners-bracket entrant has won the Grand Final', () => {
    const html = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', 'p1')]);
    expect(html).not.toContain('(if necessary)');
    expect(html).not.toContain('Match 11');
    expect(html).toContain(`/matches/m-gf-0-0"`);
  });

  it('keeps it when the losers-bracket entrant won the Grand Final (the reset will be played)', () => {
    const html = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', 'p5')]);
    expect(html).toContain('Loser of M10 (if necessary)');
  });

  it('draws no reset skeleton for a tournament with the reset switched off', () => {
    const open = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', null)], false, false);
    expect(open).not.toContain('(if necessary)');
    expect(open).not.toContain('Match 11');
    const lbWon = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', 'p5')], false, false);
    expect(lbWon).not.toContain('(if necessary)');
  });

  it('still draws a reset match played before the reset was switched off', () => {
    const html = view(
      [WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', 'p5'), slotMatch('gf-0-1', 'p5', 'p1', 'p5')],
      false,
      false,
    );
    expect(html).toContain(`/matches/m-gf-0-1"`);
  });
});

describe('ElimBracketView — in German', () => {
  it('translates headings, round names, feeder labels, open slots and status chips', () => {
    const html = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', null)], true);
    for (const german of [
      '>Gewinnerseite<',
      '>Verliererseite<',
      '>Großes Finale<',
      '>Halbfinale<',
      '>Verliererseite · Runde 1<',
      '>Gewinnerseite · Finale<',
      'Sieger aus M10',
      'Verlierer aus M10 (falls nötig)',
      'Setzplatz 5',
      'aria-label="Spiel 11 Offen"',
      '>Beendet<',
      '>Angesetzt<',
    ]) {
      expect(html).toContain(german);
    }
    for (const english of ['Winners Bracket', 'Losers Bracket', 'Semifinals', 'Winner of', 'if necessary', 'TBD', 'Completed']) {
      expect(html).not.toContain(english);
    }
  });

  it('leaves the English bracket untouched without a copy', () => {
    const html = view([WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', null)]);
    for (const english of ['Winners Bracket', 'Losers Bracket', '>Semifinals<', 'Winner of', '>Completed<']) {
      expect(html).toContain(english);
    }
  });
});

describe("ElimBracketView — in the viewer's language (no copy override)", () => {
  const played = () => [WINNERS_FINAL, LOSERS_FINAL, slotMatch('gf-0-0', 'p1', 'p5', null)];

  it("draws a German viewer's bracket in German: headings, round names, feeder labels, open slots, chips", () => {
    const html = viewIn('de', played());
    for (const german of [
      '>Gewinnerseite<',
      '>Verliererseite<',
      '>Großes Finale<',
      '>Halbfinale<',
      '>Verliererseite · Runde 1<',
      '>Gewinnerseite · Finale<',
      'Sieger aus M10',
      'Verlierer aus M10 (falls nötig)',
      'Setzplatz 5',
      'aria-label="Spiel 11 Offen"',
      '>Beendet<',
      '>Angesetzt<',
    ]) {
      expect(html).toContain(german);
    }
    for (const english of ['Winners Bracket', 'Losers Bracket', 'Semifinals', 'Winner of', 'if necessary', 'TBD', 'Completed']) {
      expect(html).not.toContain(english);
    }
  });

  it("draws an English viewer's bracket exactly as the provider-less render", () => {
    expect(viewIn('en', played())).toBe(view(played()));
  });
});
