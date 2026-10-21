/** `draftErrorResponse` (draft-backend §7.8, §9; B-SNAP). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { draftErrorResponse } from '@/lib/draft/http';
import { DraftRuleError } from '@/lib/draft/errors';
import type { DraftSnapshotDTO } from '@/types/draft-queue';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
afterEach(() => errorSpy.mockClear());

describe('draftErrorResponse', () => {
  it('answers a DraftRuleError with its status, code, params, detail and snapshot', async () => {
    const snapshot = { state_version: 3 } as unknown as DraftSnapshotDTO;
    const res = draftErrorResponse(
      new DraftRuleError('INSUFFICIENT_BUDGET', { price: 20, remaining: 12 }, { line_id: 'aa--bb' }),
      'Failed to make pick',
      { snapshot },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Insufficient budget: this line costs 20 P, you have 12 P.',
      code: 'INSUFFICIENT_BUDGET',
      params: { price: 20, remaining: 12 },
      detail: { line_id: 'aa--bb' },
      snapshot: { state_version: 3 },
    });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('omits params, detail and snapshot when absent', async () => {
    const res = draftErrorResponse(new DraftRuleError('NOT_YOUR_TURN'), 'x');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'It is not your turn.', code: 'NOT_YOUR_TURN' });
  });

  it('answers a ZodError with 400 validation_failed {issues}', async () => {
    const parsed = z.object({ slot_id: z.uuid() }).strict().safeParse({ slot_id: 'nope' });
    if (parsed.success) throw new Error('expected a zod failure');
    const res = draftErrorResponse(parsed.error, 'Failed to make pick');
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.params.issues).toContain('slot_id');
    expect(json.error).toBe(`Invalid request: ${json.params.issues}`);
  });

  it('answers a malformed JSON body with 400 invalid_json', async () => {
    const parseError = await new Request('http://x', { method: 'POST', body: '{nope' }).json().catch((e: unknown) => e);
    expect(parseError).toBeInstanceOf(SyntaxError);
    const res = draftErrorResponse(parseError, 'Failed to make pick');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
  });

  it('hides anything else behind the fallback', async () => {
    const res = draftErrorResponse(new Error('db exploded: secret'), 'Failed to make pick');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to make pick' });
  });
});
