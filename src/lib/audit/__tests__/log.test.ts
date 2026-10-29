import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, from } = vi.hoisted(() => {
  const insert = vi.fn();
  return { insert, from: vi.fn(() => ({ insert })) };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from } }));

import { logAuditEvent, type AuditLogEntry } from '../log';
import { runWithAgentAuditContext, type AgentAuditContext } from '../agent-context';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  actor_id: 'admin-1',
  actor_name: 'Admin',
  action: 'season.update',
  resource_type: 'season',
  resource_id: 'season-1',
  ...over,
});

const agentCtx: AgentAuditContext = {
  agent_conversation_id: 'conv-1',
  agent_proposal_id: 'prop-1',
  agent_step: 'create_league',
  approved_by: 'admin-1',
};

function insertedRow(): Record<string, unknown> {
  expect(insert).toHaveBeenCalledTimes(1);
  return insert.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  from.mockClear();
});

describe('logAuditEvent without an agent context', () => {
  it('writes the entry as given', () => {
    const metadata = { phases: 2 };
    logAuditEvent(entry({ resource_name: 'Spring', metadata, ip_address: '203.0.113.9' }));

    expect(from).toHaveBeenCalledWith('audit_log');
    expect(insertedRow()).toEqual({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.update',
      resource_type: 'season',
      resource_id: 'season-1',
      resource_name: 'Spring',
      changes: undefined,
      metadata: { phases: 2 },
      ip_address: '203.0.113.9',
    });
    // The same object, not a copy: nothing is merged in.
    expect(insertedRow().metadata).toBe(metadata);
  });

  it('keeps absent metadata absent', () => {
    logAuditEvent(entry());

    const row = insertedRow();
    expect(row.metadata).toBeUndefined();
    expect(row.resource_name).toBeNull();
    expect(row.ip_address).toBeNull();
  });
});

describe('logAuditEvent inside an agent context', () => {
  it('adds via and the context fields to the metadata, keeping the human as actor', () => {
    runWithAgentAuditContext(agentCtx, () => logAuditEvent(entry({ metadata: { phases: 2 } })));

    const row = insertedRow();
    expect(row.actor_id).toBe('admin-1');
    expect(row.actor_name).toBe('Admin');
    expect(row.metadata).toEqual({
      phases: 2,
      via: 'agent',
      agent_conversation_id: 'conv-1',
      agent_proposal_id: 'prop-1',
      agent_step: 'create_league',
      approved_by: 'admin-1',
    });
  });

  it('writes the metadata even when the route sent none', () => {
    runWithAgentAuditContext(agentCtx, () => logAuditEvent(entry()));

    expect(insertedRow().metadata).toMatchObject({ via: 'agent', agent_proposal_id: 'prop-1' });
  });

  it('carries the optional fields that are set and no key for the ones that are not', () => {
    runWithAgentAuditContext(
      { ...agentCtx, agent_tool: 'league_create', model: 'm-1', plan_code: undefined },
      () => logAuditEvent(entry()),
    );

    const metadata = insertedRow().metadata as Record<string, unknown>;
    expect(metadata.agent_tool).toBe('league_create');
    expect(metadata.model).toBe('m-1');
    expect('plan_code' in metadata).toBe(false);
  });

  it('wins over metadata of the route with the same key', () => {
    runWithAgentAuditContext(agentCtx, () =>
      logAuditEvent(entry({ metadata: { via: 'human', approved_by: 'someone-else' } })),
    );

    expect(insertedRow().metadata).toMatchObject({ via: 'agent', approved_by: 'admin-1' });
  });

  it('does not change the metadata object the caller passed', () => {
    const metadata = { phases: 2 };
    runWithAgentAuditContext(agentCtx, () => logAuditEvent(entry({ metadata })));

    expect(metadata).toEqual({ phases: 2 });
  });

  it('tags events written after an await inside the run, and none after it', async () => {
    await runWithAgentAuditContext(agentCtx, async () => {
      await Promise.resolve();
      logAuditEvent(entry({ action: 'season.clone' }));
    });
    logAuditEvent(entry({ action: 'season.update' }));

    expect(insert).toHaveBeenCalledTimes(2);
    expect((insert.mock.calls[0][0] as { metadata: object }).metadata).toMatchObject({ via: 'agent' });
    expect((insert.mock.calls[1][0] as { metadata?: object }).metadata).toBeUndefined();
  });

  it('keeps concurrent runs apart', async () => {
    const run = (id: string, wait: number) =>
      runWithAgentAuditContext({ ...agentCtx, agent_proposal_id: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, wait));
        logAuditEvent(entry({ resource_id: id }));
      });

    await Promise.all([run('prop-a', 4), run('prop-b', 1)]);

    const rows = insert.mock.calls.map(
      ([row]) => row as { resource_id: string; metadata: { agent_proposal_id: string } },
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.metadata.agent_proposal_id).toBe(row.resource_id);
  });
});

describe('logAuditEvent failure handling', () => {
  it('swallows an insert error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insert.mockResolvedValue({ error: { message: 'nope' } });

    expect(() => runWithAgentAuditContext(agentCtx, () => logAuditEvent(entry()))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
