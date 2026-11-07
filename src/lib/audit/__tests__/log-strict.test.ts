import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, from } = vi.hoisted(() => {
  const insert = vi.fn();
  return { insert, from: vi.fn(() => ({ insert })) };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from } }));

import { logAuditEventStrict, type AuditLogEntry } from '../log';
import { runWithAgentAuditContext } from '../agent-context';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  actor_id: 'admin-1',
  actor_name: 'Admin',
  action: 'season.format.relations.view_hidden',
  resource_type: 'season',
  resource_id: 'season-1',
  metadata: { relations: ['santa'] },
  ...over,
});

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  from.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('logAuditEventStrict', () => {
  it('resolves only after the row is written', async () => {
    let settle: (value: { error: null }) => void = () => undefined;
    insert.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    let done = false;
    const pending = logAuditEventStrict(entry()).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    settle({ error: null });
    await pending;
    expect(done).toBe(true);
    expect(from).toHaveBeenCalledWith('audit_log');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.format.relations.view_hidden', actor_id: 'admin-1', metadata: { relations: ['santa'] } }),
    );
  });

  it('rejects with a generic message when the database answers an error, and does not leak it', async () => {
    insert.mockResolvedValue({ error: { message: 'relation "audit_log" does not exist' } });
    const failure = await logAuditEventStrict(entry()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Audit entry could not be written');
    expect(console.error).toHaveBeenCalled();
  });

  it('rejects when the insert itself throws or rejects', async () => {
    insert.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(logAuditEventStrict(entry())).rejects.toThrow('Audit entry could not be written');
    insert.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(logAuditEventStrict(entry())).rejects.toThrow('Audit entry could not be written');
  });

  it('tags the row with the agent provenance like logAuditEvent', async () => {
    await runWithAgentAuditContext(
      { agent_conversation_id: 'c', agent_proposal_id: 'p', agent_step: 's', approved_by: 'admin-1' },
      () => logAuditEventStrict(entry()),
    );
    expect((insert.mock.calls[0][0] as { metadata: object }).metadata).toMatchObject({ via: 'agent', relations: ['santa'] });
  });
});
