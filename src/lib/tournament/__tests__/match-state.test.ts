import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  getValidNextStates,
  validateTransition,
  hasReachedBoThreshold,
  isMatchStatus,
} from '../match-state';
import type { TransitionContext } from '../match-state';

// ── Transition map ──────────────────────────────────────────────────

describe('isValidTransition', () => {
  it('allows scheduled → in_progress', () => {
    expect(isValidTransition('scheduled', 'in_progress')).toBe(true);
  });

  it('allows in_progress → pending_confirmation', () => {
    expect(isValidTransition('in_progress', 'pending_confirmation')).toBe(true);
  });

  it('allows in_progress → in_progress (additional games)', () => {
    expect(isValidTransition('in_progress', 'in_progress')).toBe(true);
  });

  it('allows pending_confirmation → completed', () => {
    expect(isValidTransition('pending_confirmation', 'completed')).toBe(true);
  });

  it('allows pending_confirmation → disputed', () => {
    expect(isValidTransition('pending_confirmation', 'disputed')).toBe(true);
  });

  it('allows disputed → completed (admin override)', () => {
    expect(isValidTransition('disputed', 'completed')).toBe(true);
  });

  it('rejects completed → anything', () => {
    expect(isValidTransition('completed', 'scheduled')).toBe(false);
    expect(isValidTransition('completed', 'in_progress')).toBe(false);
    expect(isValidTransition('completed', 'disputed')).toBe(false);
  });

  it('rejects skipping states (scheduled → completed)', () => {
    expect(isValidTransition('scheduled', 'completed')).toBe(false);
    expect(isValidTransition('scheduled', 'pending_confirmation')).toBe(false);
  });
});

describe('getValidNextStates', () => {
  it('returns correct states for each status', () => {
    expect(getValidNextStates('scheduled')).toEqual(['in_progress']);
    expect(getValidNextStates('in_progress')).toEqual(['in_progress', 'pending_confirmation']);
    expect(getValidNextStates('pending_confirmation')).toEqual(['completed', 'disputed']);
    expect(getValidNextStates('disputed')).toEqual(['completed']);
    expect(getValidNextStates('completed')).toEqual([]);
  });
});

// ── Context-aware validation ────────────────────────────────────────

describe('validateTransition', () => {
  const baseCtx: TransitionContext = {
    actor_id: 'player-1',
    is_admin: false,
    player_1_id: 'player-1',
    player_2_id: 'player-2',
  };

  it('rejects invalid state transitions', () => {
    const result = validateTransition('scheduled', 'completed', baseCtx);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid transition');
  });

  it('allows a participant to confirm', () => {
    const result = validateTransition('pending_confirmation', 'completed', {
      ...baseCtx,
      winner_id: 'player-1',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects confirmation without a winner', () => {
    const result = validateTransition('pending_confirmation', 'completed', baseCtx);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('without a winner');
  });

  it('rejects a non-participant confirming', () => {
    const result = validateTransition('pending_confirmation', 'completed', {
      ...baseCtx,
      actor_id: 'outsider',
      winner_id: 'player-1',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('participants or admins');
  });

  it('allows admin to confirm', () => {
    const result = validateTransition('pending_confirmation', 'completed', {
      ...baseCtx,
      actor_id: 'admin-user',
      is_admin: true,
      winner_id: 'player-1',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-admin resolving dispute', () => {
    const result = validateTransition('disputed', 'completed', baseCtx);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Only admins');
  });

  it('allows admin to resolve dispute', () => {
    const result = validateTransition('disputed', 'completed', {
      ...baseCtx,
      is_admin: true,
      winner_id: 'player-1',
    });
    expect(result.valid).toBe(true);
  });

  it('allows admin to complete an in-progress match override', () => {
    const result = validateTransition('in_progress', 'completed', {
      ...baseCtx,
      actor_id: 'admin-user',
      is_admin: true,
      winner_id: 'player-2',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects completion with a non-participant winner', () => {
    const result = validateTransition('pending_confirmation', 'completed', {
      ...baseCtx,
      winner_id: 'outsider',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('match participants');
  });

  it.each([
    [
      'invalid transition',
      'scheduled' as const,
      'completed' as const,
      baseCtx,
      { error: 'Invalid transition: scheduled → completed', code: 'match_transition_invalid', params: { from: 'scheduled', to: 'completed' } },
    ],
    [
      'non-admin dispute resolution',
      'disputed' as const,
      'completed' as const,
      { ...baseCtx, winner_id: 'player-1' },
      { error: 'Only admins can resolve disputed matches', code: 'match_dispute_resolve_admin_only' },
    ],
    [
      'completion without a winner',
      'pending_confirmation' as const,
      'completed' as const,
      baseCtx,
      { error: 'Cannot complete a match without a winner', code: 'match_complete_no_winner' },
    ],
    [
      'non-participant winner',
      'pending_confirmation' as const,
      'completed' as const,
      { ...baseCtx, winner_id: 'outsider' },
      { error: 'Winner must be one of the match participants', code: 'match_winner_not_participant' },
    ],
    [
      'non-participant confirming',
      'pending_confirmation' as const,
      'completed' as const,
      { ...baseCtx, actor_id: 'outsider', winner_id: 'player-1' },
      { error: 'Only match participants or admins can confirm results', code: 'match_confirm_participants_only' },
    ],
    [
      'non-participant disputing',
      'pending_confirmation' as const,
      'disputed' as const,
      { ...baseCtx, actor_id: 'outsider' },
      { error: 'Only match participants or admins can dispute results', code: 'match_dispute_participants_only' },
    ],
  ])('returns the English error, code and params for %s', (_label, from, to, ctx, expected) => {
    expect(validateTransition(from, to, ctx)).toEqual({ valid: false, ...expected });
  });

  // Admin-only transitions (ADMIN_TRANSITIONS minus VALID_TRANSITIONS) tried
  // by a non-admin get their own code, not match_transition_invalid.
  it.each([
    ['in_progress', 'scheduled'],
    ['pending_confirmation', 'in_progress'],
    ['pending_confirmation', 'scheduled'],
    ['completed', 'scheduled'],
    ['disputed', 'scheduled'],
  ] as const)('rejects a non-admin reset %s → %s with match_reset_admin_only', (from, to) => {
    expect(validateTransition(from, to, baseCtx)).toEqual({
      valid: false,
      error: 'Only admins can reset match state',
      code: 'match_reset_admin_only',
    });
  });

  it.each([
    ['in_progress', 'completed'],
    ['in_progress', 'disputed'],
  ] as const)('rejects a non-admin forward override %s → %s with match_status_override_admin_only', (from, to) => {
    expect(validateTransition(from, to, { ...baseCtx, winner_id: 'player-1' })).toEqual({
      valid: false,
      error: 'Only admins can complete or dispute a match that is still in progress',
      code: 'match_status_override_admin_only',
    });
  });

  it.each([
    ['in_progress', 'scheduled'],
    ['pending_confirmation', 'in_progress'],
    ['completed', 'scheduled'],
    ['disputed', 'scheduled'],
    ['in_progress', 'disputed'],
  ] as const)('allows an admin %s → %s', (from, to) => {
    expect(validateTransition(from, to, { ...baseCtx, actor_id: 'admin-user', is_admin: true })).toEqual({ valid: true });
  });

  it('keeps match_transition_invalid for a move that is in neither table', () => {
    expect(validateTransition('scheduled', 'pending_confirmation', baseCtx).code).toBe('match_transition_invalid');
    expect(
      validateTransition('scheduled', 'pending_confirmation', { ...baseCtx, is_admin: true }).code
    ).toBe('match_transition_invalid');
  });

  it('rejects non-participant disputing', () => {
    const result = validateTransition('pending_confirmation', 'disputed', {
      ...baseCtx,
      actor_id: 'outsider',
    });
    expect(result.valid).toBe(false);
  });

  it('allows participant to dispute', () => {
    const result = validateTransition('pending_confirmation', 'disputed', {
      ...baseCtx,
      actor_id: 'player-2',
    });
    expect(result.valid).toBe(true);
  });
});

// ── Best-of threshold ───────────────────────────────────────────────

describe('hasReachedBoThreshold', () => {
  it('Bo1: 1–0 is done', () => {
    const r = hasReachedBoThreshold(1, 1, 0);
    expect(r.reached).toBe(true);
    expect(r.winner_id_index).toBe(1);
  });

  it('Bo3: 2–0 is done (player 1 wins)', () => {
    const r = hasReachedBoThreshold(3, 2, 0);
    expect(r.reached).toBe(true);
    expect(r.winner_id_index).toBe(1);
  });

  it('Bo3: 1–2 is done (player 2 wins)', () => {
    const r = hasReachedBoThreshold(3, 1, 2);
    expect(r.reached).toBe(true);
    expect(r.winner_id_index).toBe(2);
  });

  it('Bo3: 1–1 is NOT done', () => {
    const r = hasReachedBoThreshold(3, 1, 1);
    expect(r.reached).toBe(false);
    expect(r.winner_id_index).toBe(null);
  });

  it('Bo5: needs 3 wins', () => {
    expect(hasReachedBoThreshold(5, 2, 2).reached).toBe(false);
    expect(hasReachedBoThreshold(5, 3, 1).reached).toBe(true);
    expect(hasReachedBoThreshold(5, 3, 1).winner_id_index).toBe(1);
  });
});

// ── Unknown states fail closed (M8) ─────────────────────────────────

describe('unknown match status', () => {
  const ctx: TransitionContext = {
    actor_id: 'p1',
    is_admin: false,
    winner_id: 'p1',
    player_1_id: 'p1',
    player_2_id: 'p2',
  };

  it('isMatchStatus accepts exactly the five enum labels', () => {
    for (const s of ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed']) {
      expect(isMatchStatus(s)).toBe(true);
    }
    for (const s of ['', 'Completed', 'bogus', 'constructor', '__proto__', 'toString', null, undefined, 1]) {
      expect(isMatchStatus(s)).toBe(false);
    }
  });

  it.each(['bogus', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'treats %j as having no next states instead of throwing',
    (from) => {
      expect(isValidTransition(from as never, 'completed')).toBe(false);
      expect(isValidTransition(from as never, 'scheduled', true)).toBe(false);
      expect(getValidNextStates(from as never)).toEqual([]);
      expect(getValidNextStates(from as never, true)).toEqual([]);
    }
  );

  it.each([false, true])(
    'validateTransition returns match_transition_invalid for an unknown from (is_admin=%s)',
    (isAdmin) => {
      const result = validateTransition('bogus' as never, 'completed', { ...ctx, is_admin: isAdmin });
      expect(result).toEqual({
        valid: false,
        error: 'Invalid transition: bogus → completed',
        code: 'match_transition_invalid',
        params: { from: 'bogus', to: 'completed' },
      });
    }
  );

  it('validateTransition rejects an unknown to', () => {
    const result = validateTransition('pending_confirmation', 'bogus' as never, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe('match_transition_invalid');
  });
});
