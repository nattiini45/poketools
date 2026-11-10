import { describe, expect, it } from 'vitest';
import type { MatchStatus } from '@/types/match';
import { matchMachine, validateTransition } from '@/lib/tournament/match-state';
import { availableMatchActions } from '../match-actions';

const STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'];
const match = (status: MatchStatus, submitter_id: string | null = 'p1') => ({ status, player_1_id: 'p1', player_2_id: 'p2', submitter_id });
const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe('availableMatchActions', () => {
  it('offers a player the moves of their own match', () => {
    expect(sorted(availableMatchActions(match('scheduled'), { playerId: 'p2', isAdmin: false }))).toEqual(['record_game']);
    expect(sorted(availableMatchActions(match('in_progress'), { playerId: 'p2', isAdmin: false }))).toEqual(['reach_threshold', 'record_game']);
    expect(sorted(availableMatchActions(match('pending_confirmation'), { playerId: 'p2', isAdmin: false }))).toEqual(['confirm', 'dispute']);
    expect(sorted(availableMatchActions(match('completed'), { playerId: 'p2', isAdmin: false }))).toEqual([]);
    expect(sorted(availableMatchActions(match('disputed'), { playerId: 'p2', isAdmin: false }))).toEqual([]);
  });

  it('never offers the submitter the confirmation of their own result, unless they are an admin', () => {
    expect(sorted(availableMatchActions(match('pending_confirmation', 'p1'), { playerId: 'p1', isAdmin: false }))).toEqual(['dispute']);
    expect(availableMatchActions(match('pending_confirmation', 'p1'), { playerId: 'p1', isAdmin: true }).has('confirm')).toBe(true);
  });

  it('offers nothing to a player outside the match or a signed-out viewer', () => {
    for (const status of STATUSES) {
      expect(availableMatchActions(match(status), { playerId: 'x', isAdmin: false }).size).toBe(0);
      expect(availableMatchActions(match(status), { playerId: null, isAdmin: false }).size).toBe(0);
    }
  });

  it('offers only moves validateTransition accepts for that viewer', () => {
    for (const status of STATUSES) {
      for (const viewer of [
        { playerId: 'p2', isAdmin: false },
        { playerId: 'p1', isAdmin: false },
        { playerId: 'a', isAdmin: true },
      ]) {
        for (const event of availableMatchActions(match(status), viewer)) {
          const transition = matchMachine.spec.transitions.find((t) => t.event === event && t.from.includes(status));
          const result = validateTransition(status, transition!.to, {
            actor_id: viewer.playerId,
            is_admin: viewer.isAdmin,
            winner_id: 'p1',
            player_1_id: 'p1',
            player_2_id: 'p2',
          });
          expect(result.valid, `${status} ${event} ${JSON.stringify(viewer)}`).toBe(true);
        }
      }
    }
  });
});
