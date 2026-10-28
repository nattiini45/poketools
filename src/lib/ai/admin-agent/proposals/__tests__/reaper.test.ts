/**
 * The reaper, on its own: the same function the executor runs before a claim and the chat turn runs before its loop. The
 * executor's tests cover it inside an approve; the chat route's tests cover the call site.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { stripComments } from '../../__tests__/architecture/graph';
import { uid } from '../../plans/__tests__/fixtures';
import type { ProposalRecord } from '../../store/types';
import { REAPER_AGE_MS, RESULT_EVENT, ROUTE_MAX_DURATION_SECONDS, reapOverdueProposals, type ReaperDeps } from '../reaper';
import * as executor from '../executor';
import { ADMIN } from './helpers';

const NOW = new Date('2026-10-28T10:00:00.000Z');
const proposal = (id: string, conversation: string): ProposalRecord => ({ id, conversation_id: conversation, proposal_hash: 'ab12cd34'.repeat(8) }) as unknown as ProposalRecord;

function deps(overrides: Partial<ReaperDeps['proposals']> = {}) {
  const events: Array<{ conversationId: string; event: string; data: unknown }> = [];
  const reap = vi.fn(async (_admin: string, _olderThan: Date) => [uid(1), uid(2)]);
  const built: ReaperDeps = {
    proposals: {
      reapExecutingProposals: reap,
      getProposal: async (_admin, id) => proposal(id, id === uid(1) ? uid(11) : uid(12)),
      ...overrides,
    },
    recordEvent: async (_admin, conversationId, event, data) => {
      events.push({ conversationId, event, data });
    },
    now: () => NOW,
  };
  return { built, events, reap };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('reapOverdueProposals', () => {
  it('reaps what is older than twice maxDuration for this admin and tells each conversation, with the same event the executor appends', async () => {
    const { built, events, reap } = deps();
    await reapOverdueProposals(built, ADMIN);

    expect(reap).toHaveBeenCalledWith(ADMIN, new Date(NOW.getTime() - REAPER_AGE_MS));
    expect(REAPER_AGE_MS).toBe(2 * ROUTE_MAX_DURATION_SECONDS * 1000);
    expect(events).toEqual([
      { conversationId: uid(11), event: RESULT_EVENT, data: { proposal_id: uid(1), plan_code: 'ab12cd34', status: 'unknown', reaped: true } },
      { conversationId: uid(12), event: RESULT_EVENT, data: { proposal_id: uid(2), plan_code: 'ab12cd34', status: 'unknown', reaped: true } },
    ]);
  });

  it('says nothing when nothing is overdue', async () => {
    const { built, events } = deps({ reapExecutingProposals: async () => [] });
    await reapOverdueProposals(built, ADMIN);
    expect(events).toEqual([]);
  });

  it('does not throw when the reap itself fails, and logs it', async () => {
    const { built, events } = deps({
      reapExecutingProposals: async () => {
        throw new Error('db down');
      },
    });
    await expect(reapOverdueProposals(built, ADMIN)).resolves.toBeUndefined();
    expect(events).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('keeps telling the other conversations when one event cannot be recorded', async () => {
    const { built, events } = deps();
    const told: string[] = [];
    await reapOverdueProposals(
      {
        ...built,
        recordEvent: async (_admin, conversationId) => {
          if (conversationId === uid(11)) throw new Error('lease busy');
          told.push(conversationId);
        },
      },
      ADMIN,
    );
    expect(told).toEqual([uid(12)]);
    expect(events).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('skips a proposal that is gone by the time it is read', async () => {
    const { built, events } = deps({ getProposal: async (_admin, id) => (id === uid(1) ? null : proposal(id, uid(12))) });
    await reapOverdueProposals(built, ADMIN);
    expect(events.map((entry) => entry.conversationId)).toEqual([uid(12)]);
  });
});

describe('where the reaper lives', () => {
  it('is the module the executor re-exports its constants from, so the two cannot disagree', () => {
    expect(executor.REAPER_AGE_MS).toBe(REAPER_AGE_MS);
    expect(executor.RESULT_EVENT).toBe(RESULT_EVENT);
    expect(executor.ROUTE_MAX_DURATION_SECONDS).toBe(ROUTE_MAX_DURATION_SECONDS);
  });

  it('imports no executor, no binding and no database client: the chat turn imports it', () => {
    const source = stripComments(readFileSync(path.join(process.cwd(), 'src/lib/ai/admin-agent/proposals/reaper.ts'), 'utf8'));
    expect(source).not.toMatch(/executor|_ops|@\/lib\/supabase|@\/app\//);
    expect(source).not.toMatch(/\.message\b/);
  });
});
