import { describe, expect, it } from 'vitest';
import { getAgentAuditContext, runWithAgentAuditContext, type AgentAuditContext } from '../agent-context';

const ctx = (n: number, extra: Partial<AgentAuditContext> = {}): AgentAuditContext => ({
  agent_conversation_id: `conv-${n}`,
  agent_proposal_id: `prop-${n}`,
  agent_step: `step-${n}`,
  approved_by: `admin-${n}`,
  ...extra,
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('agent audit context', () => {
  it('is absent outside a run', () => {
    expect(getAgentAuditContext()).toBeUndefined();
  });

  it('is visible inside the run, across awaits, and gone afterwards', async () => {
    const seen = await runWithAgentAuditContext(ctx(1), async () => {
      await tick();
      return getAgentAuditContext();
    });

    expect(seen).toEqual(ctx(1));
    expect(getAgentAuditContext()).toBeUndefined();
  });

  it('returns the value of fn', () => {
    expect(runWithAgentAuditContext(ctx(1), () => 42)).toBe(42);
  });

  it('is gone after fn throws', () => {
    expect(() =>
      runWithAgentAuditContext(ctx(1), () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getAgentAuditContext()).toBeUndefined();
  });

  it('a nested run replaces the outer context and the outer one returns afterwards', () => {
    runWithAgentAuditContext(ctx(1), () => {
      expect(getAgentAuditContext()?.agent_step).toBe('step-1');
      runWithAgentAuditContext(ctx(2), () => {
        expect(getAgentAuditContext()?.agent_step).toBe('step-2');
      });
      expect(getAgentAuditContext()?.agent_step).toBe('step-1');
    });
  });

  it('does not leak between concurrent async runs', async () => {
    const run = (n: number, delays: number[]) =>
      runWithAgentAuditContext(ctx(n), async () => {
        const seen: Array<string | undefined> = [getAgentAuditContext()?.agent_step];
        for (const delay of delays) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          seen.push(getAgentAuditContext()?.agent_step);
        }
        return seen;
      });

    const [a, b, c] = await Promise.all([run(1, [5, 1, 3]), run(2, [1, 6, 2]), run(3, [3, 3, 3])]);

    expect(new Set(a)).toEqual(new Set(['step-1']));
    expect(new Set(b)).toEqual(new Set(['step-2']));
    expect(new Set(c)).toEqual(new Set(['step-3']));
    expect(getAgentAuditContext()).toBeUndefined();
  });

  it('holds a frozen copy: changing the input afterwards does not reach the run', () => {
    const input = ctx(1);
    runWithAgentAuditContext(input, () => {
      input.agent_step = 'changed';
      const seen = getAgentAuditContext();
      expect(seen?.agent_step).toBe('step-1');
      expect(Object.isFrozen(seen)).toBe(true);
    });
  });
});
