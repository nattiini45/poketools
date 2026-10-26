import { describe, expect, it } from 'vitest';
import type { MatchStatus } from '@/types/match';
import { matchRowActions, type AdminMatchViewer } from '../match-row-actions';

const P1 = 'p1';
const P2 = 'p2';
const OTHER = 'someone-else';

const match = (status: MatchStatus) => ({ status, player_1_id: P1, player_2_id: P2 });
const viewer = (patch: Partial<AdminMatchViewer>): AdminMatchViewer => ({
  playerId: OTHER,
  isSiteAdmin: false,
  isSuperadmin: false,
  ...patch,
});

describe('matchRowActions', () => {
  it.each(['scheduled', 'in_progress'] as const)('offers both buttons to a participant of a %s match', (status) => {
    expect(matchRowActions(match(status), viewer({ playerId: P1 }))).toEqual({ submitResult: true, viewPrep: true });
    expect(matchRowActions(match(status), viewer({ playerId: P2 }))).toEqual({ submitResult: true, viewPrep: true });
  });

  it('offers Submit Result, but not View Prep, to a site admin who does not play', () => {
    expect(matchRowActions(match('scheduled'), viewer({ isSiteAdmin: true }))).toEqual({
      submitResult: true,
      viewPrep: false,
    });
  });

  it('offers View Prep, but not Submit Result, to a superadmin who is not a site admin and does not play', () => {
    expect(matchRowActions(match('scheduled'), viewer({ isSuperadmin: true }))).toEqual({
      submitResult: false,
      viewPrep: true,
    });
  });

  it('offers both to a superadmin who is also a site admin', () => {
    expect(matchRowActions(match('in_progress'), viewer({ isSiteAdmin: true, isSuperadmin: true }))).toEqual({
      submitResult: true,
      viewPrep: true,
    });
  });

  it('offers neither to a resource admin who does not play in the match', () => {
    expect(matchRowActions(match('scheduled'), viewer({}))).toEqual({ submitResult: false, viewPrep: false });
  });

  it('offers neither without a viewer', () => {
    expect(matchRowActions(match('scheduled'), null)).toEqual({ submitResult: false, viewPrep: false });
  });

  it('offers neither to an identity without a player (both pages redirect it)', () => {
    expect(
      matchRowActions(match('scheduled'), viewer({ playerId: null, isSiteAdmin: true, isSuperadmin: true })),
    ).toEqual({ submitResult: false, viewPrep: false });
  });

  it.each(['pending_confirmation', 'completed', 'disputed'] as MatchStatus[])(
    'offers neither once the match is %s, whoever looks',
    (status) => {
      const everyone = viewer({ playerId: P1, isSiteAdmin: true, isSuperadmin: true });
      expect(matchRowActions(match(status), everyone)).toEqual({ submitResult: false, viewPrep: false });
    },
  );
});
