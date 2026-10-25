import { describe, it, expect } from 'vitest';
import {
  MATCH_HISTORY_MAX_OFFSET,
  MATCH_HISTORY_MAX_PAGE_SIZE,
  MATCH_HISTORY_PAGE_SIZE,
  MATCH_REASON_MAX_LENGTH,
  historyPanelKey,
  isOverdue,
  toMatchHistoryEntry,
} from '../match-detail';
import type { AuditLogRecord } from '@/lib/audit/queries';

function row(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: 'a1',
    actor_id: 'p1',
    actor_name: 'Alice',
    action: 'match.reopen',
    resource_type: 'match',
    resource_id: 'm1',
    resource_name: 'A vs B',
    changes: null,
    metadata: null,
    ip_address: '203.0.113.9',
    created_at: '2026-10-24T10:00:00Z',
    ...overrides,
  };
}

describe('constants', () => {
  it('keeps the page size inside the route limits', () => {
    expect(MATCH_REASON_MAX_LENGTH).toBe(500);
    expect(MATCH_HISTORY_PAGE_SIZE).toBeLessThanOrEqual(MATCH_HISTORY_MAX_PAGE_SIZE);
    expect(MATCH_HISTORY_MAX_OFFSET).toBe(1000);
  });
});

describe('toMatchHistoryEntry', () => {
  it('drops ip_address, resource ids and raw metadata', () => {
    const entry = toMatchHistoryEntry(row({ metadata: { tournament_id: 't1', reason: 'Wrong winner' } }));
    expect(entry).toEqual({
      id: 'a1',
      action: 'match.reopen',
      actor_id: 'p1',
      actor_name: 'Alice',
      created_at: '2026-10-24T10:00:00Z',
      reason: 'Wrong winner',
      changes: null,
    });
    expect(JSON.stringify(entry)).not.toContain('203.0.113.9');
  });

  it('returns a null reason for a missing, blank or non-string reason', () => {
    expect(toMatchHistoryEntry(row()).reason).toBeNull();
    expect(toMatchHistoryEntry(row({ metadata: { reason: '   ' } })).reason).toBeNull();
    expect(toMatchHistoryEntry(row({ metadata: { reason: 5 } })).reason).toBeNull();
    expect(toMatchHistoryEntry(row({ metadata: ['reason'] })).reason).toBeNull();
  });

  it('passes before/after changes through', () => {
    const changes = { status: { before: 'completed', after: 'in_progress' }, winner_id: { before: 'p1', after: null } };
    expect(toMatchHistoryEntry(row({ changes })).changes).toEqual(changes);
  });

  it.each([
    ['null', null],
    ['an array', [{ before: 1, after: 2 }]],
    ['a string', 'status'],
    ['a number', 7],
  ])('turns %s changes into null', (_label, changes) => {
    expect(toMatchHistoryEntry(row({ changes: changes as AuditLogRecord['changes'] })).changes).toBeNull();
  });

  it('skips entries that are not {before, after} objects', () => {
    const entry = toMatchHistoryEntry(
      row({ changes: { status: { before: 'a', after: 'b' }, junk: 'x', half: { before: 1 } } })
    );
    expect(entry.changes).toEqual({ status: { before: 'a', after: 'b' } });
  });

  it('is null when no entry survives', () => {
    expect(toMatchHistoryEntry(row({ changes: { junk: 'x' } })).changes).toBeNull();
  });
});

describe('isOverdue', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  it('is true for a past deadline on an open match', () => {
    expect(isOverdue('2026-10-24T11:59:59Z', now, 'scheduled')).toBe(true);
    expect(isOverdue('2026-10-20T00:00:00Z', now, 'disputed')).toBe(true);
  });

  it('is false for a future or equal deadline', () => {
    expect(isOverdue('2026-10-24T12:00:01Z', now, 'scheduled')).toBe(false);
    expect(isOverdue('2026-10-24T12:00:00Z', now, 'scheduled')).toBe(false);
  });

  it('is false for a completed match, no deadline or an unparseable one', () => {
    expect(isOverdue('2026-10-01T00:00:00Z', now, 'completed')).toBe(false);
    expect(isOverdue(null, now, 'scheduled')).toBe(false);
    expect(isOverdue('not a date', now, 'scheduled')).toBe(false);
  });
});

describe('historyPanelKey', () => {
  const page = (ids: string[], total: number) => ({
    entries: ids.map((id) => ({
      id,
      action: 'match.reset',
      actor_id: null,
      actor_name: '',
      created_at: '2026-10-24T10:00:00Z',
      reason: null,
      changes: null,
    })),
    total,
    offset: 0,
    limit: 20,
  });

  it('changes when an event is added, so the panel remounts on the new page', () => {
    expect(historyPanelKey(page(['b'], 1))).not.toBe(historyPanelKey(page(['c', 'b'], 2)));
  });

  it('stays the same for an identical page and tells a failed read apart', () => {
    expect(historyPanelKey(page(['b'], 1))).toBe(historyPanelKey(page(['b'], 1)));
    expect(historyPanelKey(page([], 0), true)).not.toBe(historyPanelKey(page([], 0)));
  });
});
