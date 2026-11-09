import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ openFormatCheck: vi.fn() }));
vi.mock('../runtime/load', () => ({
  loadFreshKitContext: vi.fn(),
  envBaseOf: (ctx: { def: unknown; state: unknown; seed: string }, scope: string) => ({ def: ctx.def, state: ctx.state, seed: ctx.seed, scope }),
}));

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Stage } from '@/lib/format-kit/types';
import { loadPairingAids, PairingExprError } from '../pairing-server';
import { loadFreshKitContext } from '../runtime/load';
import { SEED, stateFor, wichtelDef } from '../runtime/__tests__/helpers';

const def = wichtelDef();

beforeEach(() => {
  vi.mocked(loadFreshKitContext).mockResolvedValue({ seasonId: 's', seed: SEED, revision: 1, def, state: stateFor(def), tunableIssues: [], phases: [] });
});

describe('PairingExprError', () => {
  const failing: Pick<Stage, 'key' | 'pairing'> = {
    key: 'swiss',
    pairing: {
      kind: 'filter',
      base: { kind: 'swiss', rounds: 'auto', avoid_repeats: true },
      allow: { k: 'cmp', op: '==', a: { k: 'ref', name: 'a_attr.missing', t: 'text' }, b: { k: 'str', v: 'x' } },
    },
  };

  it('is a 422 the generate routes answer, not a generic 500', async () => {
    const aids = await loadPairingAids({ seasonId: 's', stage: failing, roundNumber: 1, playerIds: ['p1', 'p2'] });
    let caught: unknown;
    try {
      aids.allowPair?.('p1', 'p2');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PairingExprError);
    expect(caught).toBeInstanceOf(UserFacingError);
    expect(caught).toMatchObject({ code: 'pairing_expr_failed', statusCode: 422, pair: ['p1', 'p2'] });
  });

  it('keeps the player ids out of the client-facing message', () => {
    const error = new PairingExprError('expr_unknown_ref', ['player-secret-1', 'player-secret-2']);
    expect(error.message).not.toContain('player-secret');
    expect(JSON.stringify(error.params)).not.toContain('player-secret');
    expect(error.exprCode).toBe('expr_unknown_ref');
  });
});
