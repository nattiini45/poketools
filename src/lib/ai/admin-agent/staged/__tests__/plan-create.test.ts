/** `plan_create` and the active plan's status: a second plan only once the first is finished (built or abandoned). */
import { describe, expect, it, vi } from 'vitest';
import { planCreate } from '../plan-tools';
import type { PlanRecord, PlanStatus } from '../../store/types';
import type { StagedRunnerDeps } from '../types';
import type { ToolCallContext } from '../../loop/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function harness(active: PlanStatus | null) {
  const createPlan = vi.fn(async () => ({ id: 'p2', revision: 1 }) as unknown as PlanRecord);
  const deps = {
    store: {
      plans: {
        getActivePlan: vi.fn(async () => (active === null ? null : ({ id: 'p1', status: active, revision: 4 } as unknown as PlanRecord))),
        createPlan,
      },
    },
  } as unknown as StagedRunnerDeps;
  const ctx = { adminId: ADMIN, conversationId: CONVERSATION, locale: 'en' } as unknown as ToolCallContext;
  return { deps, ctx, createPlan };
}

describe('plan_create', () => {
  it.each([
    [null, true],
    ['built', true],
    ['abandoned', true],
    ['drafting', false],
    ['ready', false],
    ['building', false],
    ['partial', false],
  ] as const)('with an active plan %s creates a new one: %s', async (active, creates) => {
    const { deps, ctx, createPlan } = harness(active);
    const result = await planCreate(deps, { mode: 'create', title: 'Spring league' }, ctx);
    expect(result.ok).toBe(creates);
    expect(createPlan).toHaveBeenCalledTimes(creates ? 1 : 0);
    if (!creates) expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
  });
});
