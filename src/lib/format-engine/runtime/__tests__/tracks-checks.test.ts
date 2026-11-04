import { describe, expect, it } from 'vitest';
import { planChecks } from '../checks';
import { envBase, matchSide } from './match-env';
import { planTrackProgress } from '../tracks';
import { PLAYERS, SEED, giftDef, stateFor } from './helpers';

const def = giftDef();

describe('planTrackProgress', () => {
  const base = (tracks = {}) => envBase(def, stateFor(def, { tracks }), SEED);

  it('moves a player one step per completed match, in order', () => {
    const b = base();
    // Round 3 win: the first step (won) is reached, the second (round >= 3) waits for the next match.
    const first = planTrackProgress(def, { stage: 'main', players: [matchSide(b, 'p1', { round: 3, won: true }), matchSide(b, 'p2', { round: 3, won: false })] }, { tracks: {} });
    expect(first.ops).toEqual([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 }]);
    const second = planTrackProgress(def, { stage: 'main', players: [matchSide(b, 'p1', { round: 3, won: true })] }, { tracks: { p1: { milestones: 1 } } });
    expect(second.ops).toEqual([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 2 }]);
  });

  it('does not skip a step when both would be true', () => {
    const b = base();
    const out = planTrackProgress(def, { stage: 'main', players: [matchSide(b, 'p1', { round: 5, won: true })] }, { tracks: {} });
    expect(out.ops).toEqual([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 }]);
  });

  it('stops at the last step and ignores other stages', () => {
    const b = base();
    const side = matchSide(b, 'p1', { round: 5, won: true });
    expect(planTrackProgress(def, { stage: 'main', players: [side] }, { tracks: { p1: { milestones: 2 } } }).ops).toEqual([]);
    expect(planTrackProgress(def, { stage: 'other', players: [side] }, { tracks: {} }).ops).toEqual([]);
  });
});

describe('planChecks', () => {
  it('opens one unresolved check per match', () => {
    const out = planChecks(def, { source: 'unresolved_outcome', matchId: 'm1', players: ['p1', 'p2'] });
    expect(out.checks).toEqual([
      { source: 'unresolved_outcome', rule_id: 'unresolved', dedupe_key: 'unresolved:m1', subject: { match_id: 'm1', players: ['p1', 'p2'] } },
    ]);
  });

  it('opens a tie check per tied group, keyed by the sorted players', () => {
    const table = [
      { player_id: 'p3', needs_decision_match: true, tie_group: 1 },
      { player_id: 'p1', needs_decision_match: true, tie_group: 1 },
      { player_id: 'p2', needs_decision_match: false, tie_group: 2 },
      { player_id: 'p4', needs_decision_match: true, tie_group: null },
    ];
    const out = planChecks(def, { source: 'standings_tie', stage: 'main', table });
    expect(out.checks.map((c) => c.dedupe_key)).toEqual(['tie:main:p1,p3']);
    expect(planChecks(def, { source: 'standings_tie', stage: 'other', table }).checks).toEqual([]);
  });

  it('opens a rematch check only when there are rematches', () => {
    expect(planChecks(def, { source: 'pairing_rematch', stage: 'main', round: 2, rematches: 0 }).checks).toEqual([]);
    expect(planChecks(def, { source: 'pairing_rematch', stage: 'main', round: 2, rematches: 2 }).checks[0]).toMatchObject({
      dedupe_key: 'rematch:main:2',
      subject: { stage: 'main', round: 2, rematches: 2 },
    });
  });

  it('opens an expression check for each subject it is true for', () => {
    const b = envBase(def, stateFor(def, { attrs: { p1: { veteran: true } } }), SEED);
    const subjects = PLAYERS.slice(0, 3).map((id) => ({ id, ctx: matchSide(b, id, { round: 1, won: true }).ctx }));
    const out = planChecks(def, { source: 'expr', of: 'player', subjects });
    expect(out.issues).toEqual([]);
    expect(out.checks.map((c) => c.dedupe_key)).toEqual(['expr:vets:p1']);
    expect(planChecks(def, { source: 'expr', of: 'match', subjects }).checks).toEqual([]);
  });
});
