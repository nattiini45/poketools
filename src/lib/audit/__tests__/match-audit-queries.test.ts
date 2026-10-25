import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq', 'or', 'order', 'limit']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.range = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { getLatestMatchDispute, listMatchAuditEvents } from '../queries';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    actor_id: 'p1',
    actor_name: 'Alice',
    action: 'match.dispute',
    resource_type: 'match',
    resource_id: MATCH_ID,
    resource_name: 'A vs B',
    changes: { status: { before: 'pending_confirmation', after: 'disputed' } },
    metadata: { reason: 'Wrong score', by_admin: false, tournament_id: 't1' },
    ip_address: '203.0.113.9',
    created_at: '2026-10-24T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of ['from', 'select', 'eq', 'or', 'order', 'limit']) {
    mockBuilder[m].mockClear();
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.range.mockReset();
});

describe('listMatchAuditEvents', () => {
  it('filters match events and game events of the match with one or()', async () => {
    mockBuilder.range.mockResolvedValue({ data: [auditRow()], error: null, count: 41 });

    const page = await listMatchAuditEvents(MATCH_ID, { limit: 20, offset: 20 });

    expect(mockBuilder.from).toHaveBeenCalledWith('audit_log');
    expect(mockBuilder.select).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(mockBuilder.or).toHaveBeenCalledTimes(1);
    const filter = mockBuilder.or.mock.calls[0][0] as string;
    expect(filter).toContain(`and(resource_type.eq.match,resource_id.eq.${MATCH_ID})`);
    expect(filter).toContain(`and(resource_type.eq.game,metadata->>match_id.eq.${MATCH_ID})`);
    expect(page.total).toBe(41);
    expect(page.offset).toBe(20);
    expect(page.limit).toBe(20);
  });

  it('orders newest first with a stable id tie-breaker and ranges by offset and limit', async () => {
    mockBuilder.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listMatchAuditEvents(MATCH_ID, { limit: 20, offset: 40 });

    expect(mockBuilder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(mockBuilder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(mockBuilder.range).toHaveBeenCalledWith(40, 59);
  });

  it('maps rows to history entries without the ip address', async () => {
    mockBuilder.range.mockResolvedValue({ data: [auditRow()], error: null, count: 1 });

    const page = await listMatchAuditEvents(MATCH_ID, { limit: 20, offset: 0 });

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ id: 'a1', action: 'match.dispute', reason: 'Wrong score' });
    expect(JSON.stringify(page)).not.toContain('203.0.113.9');
  });

  it('rejects a non-uuid id before any query', async () => {
    await expect(listMatchAuditEvents('abc),or(id.not.is.null', { limit: 20, offset: 0 })).rejects.toThrow(/match id/);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('throws a query error and treats a missing count as zero', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: [], error: new Error('boom'), count: null });
    await expect(listMatchAuditEvents(MATCH_ID, { limit: 20, offset: 0 })).rejects.toThrow('boom');

    mockBuilder.range.mockResolvedValueOnce({ data: null, error: null, count: null });
    const page = await listMatchAuditEvents(MATCH_ID, { limit: 20, offset: 0 });
    expect(page).toEqual({ entries: [], total: 0, offset: 0, limit: 20 });
  });
});

describe('getLatestMatchDispute', () => {
  it('reads the newest match.dispute event of the match', async () => {
    mockBuilder.limit.mockResolvedValue({ data: [auditRow()], error: null });

    const dispute = await getLatestMatchDispute(MATCH_ID);

    expect(mockBuilder.eq).toHaveBeenCalledWith('action', 'match.dispute');
    expect(mockBuilder.eq).toHaveBeenCalledWith('resource_type', 'match');
    expect(mockBuilder.eq).toHaveBeenCalledWith('resource_id', MATCH_ID);
    expect(mockBuilder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(mockBuilder.limit).toHaveBeenCalledWith(1);
    expect(dispute).toEqual({
      actor_id: 'p1',
      actor_name: 'Alice',
      disputed_at: '2026-10-24T10:00:00Z',
      reason: 'Wrong score',
      by_admin: false,
    });
  });

  it('flags an admin dispute and tolerates a missing reason', async () => {
    mockBuilder.limit.mockResolvedValue({
      data: [auditRow({ metadata: { by_admin: true } })],
      error: null,
    });
    await expect(getLatestMatchDispute(MATCH_ID)).resolves.toMatchObject({ reason: null, by_admin: true });
  });

  it('returns null when nothing was recorded', async () => {
    mockBuilder.limit.mockResolvedValue({ data: [], error: null });
    await expect(getLatestMatchDispute(MATCH_ID)).resolves.toBeNull();
  });

  it('rejects a non-uuid id before any query', async () => {
    await expect(getLatestMatchDispute('nope')).rejects.toThrow(/match id/);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });
});
