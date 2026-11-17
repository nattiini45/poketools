import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhaseWikiServices } from '../phase-services';
import { phaseWikiReportReceipt, toPublicPhaseWikiNote } from '../phase-public';
import { noteModerationMachine, noteModerationState } from '../note-moderation-state';
import type { PhaseWikiActor, PhaseWikiNote, PhaseWikiReport } from '@/types/phase-wiki';
import type { PhaseWikiStorage } from '@/lib/supabase/queries/phase-wiki-notes';

const phase = '10000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000002';
const author = '10000000-0000-4000-8000-000000000003';
const moderator = '10000000-0000-4000-8000-000000000004';
const base: PhaseWikiNote = {
  id, phase_id: phase, author_id: author, author_name: 'Fixture trainer', entity_type: 'move', entity_name: 'tackle',
  content: 'A useful move.', approved: false, approved_by: null, approved_at: null, rejected_by: null,
  rejected_at: null, rejection_reason: null, resubmission_blocked_at: null, resubmission_blocked_by: null,
  moderation_flags: [], created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
};
const report: PhaseWikiReport = {
  id, note_id: id, reporter_id: author, reason: 'spam', details: 'Private report', status: 'open',
  created_at: base.created_at, updated_at: base.updated_at,
};
const states = {
  pending: base,
  approved: { ...base, approved: true, approved_by: moderator, approved_at: base.updated_at },
  rejected: { ...base, rejected_at: base.updated_at, rejected_by: moderator, rejection_reason: 'Private verdict' },
  blocked: { ...base, rejected_at: base.updated_at, resubmission_blocked_at: base.updated_at, resubmission_blocked_by: moderator },
};
let actor: PhaseWikiActor;
let row: PhaseWikiNote;
const storage = {
  getNote: vi.fn<PhaseWikiStorage['getNote']>(), listNotes: vi.fn<PhaseWikiStorage['listNotes']>(),
  createNote: vi.fn<PhaseWikiStorage['createNote']>(), writeNote: vi.fn<PhaseWikiStorage['writeNote']>(),
  getReport: vi.fn<PhaseWikiStorage['getReport']>(), findReport: vi.fn<PhaseWikiStorage['findReport']>(),
  listReports: vi.fn<PhaseWikiStorage['listReports']>(), submitReport: vi.fn<PhaseWikiStorage['submitReport']>(),
  closeReport: vi.fn<PhaseWikiStorage['closeReport']>(),
};
const requireActor = vi.fn(async () => actor);
const assertPublicPhase = vi.fn(async () => {});
const invalidate = vi.fn(async () => {});
const service = createPhaseWikiServices({ storage, requireActor, assertPublicPhase, invalidate });

beforeEach(() => {
  vi.resetAllMocks();
  actor = { playerId: author, isSiteAdmin: false, isSuperadmin: false };
  row = { ...base };
  requireActor.mockImplementation(async () => actor);
  storage.getNote.mockImplementation(async () => row);
  storage.writeNote.mockResolvedValue(true);
  storage.getReport.mockResolvedValue(report);
  storage.findReport.mockResolvedValue(null);
  storage.submitReport.mockResolvedValue(report);
  storage.closeReport.mockResolvedValue(true);
  storage.createNote.mockResolvedValue(base);
});

describe('native phase wiki contracts', () => {
  it('uses real phase ownership, validates input and scans new text without publishing', async () => {
    await service.create(phase, { entity_type: 'move', entity_name: ' tackle ', content: '<b>Text</b>' });
    expect(storage.createNote).toHaveBeenCalledWith(phase, author, { entity_type: 'move', entity_name: 'tackle', content: '<b>Text</b>' }, ['html_markup']);
    expect(invalidate).toHaveBeenCalledWith(phase);
    await expect(service.create(phase, { entity_type: 'move', entity_name: 'x', content: 'x'.repeat(2001) })).rejects.toThrow();
    await expect(service.create('not-an-id', { entity_type: 'move', entity_name: 'x', content: 'x' })).rejects.toThrow();
  });

  it.each(Object.keys(states) as (keyof typeof states)[])('author edits obey the shared %s state rule', async (state) => {
    row = states[state];
    if (state === 'blocked') {
      await expect(service.edit(phase, id, 'New text')).rejects.toMatchObject({ code: 'wiki_note_resubmission_blocked' });
      expect(storage.writeNote).not.toHaveBeenCalled();
    } else {
      await service.edit(phase, id, '<b>New text</b>');
      expect(storage.writeNote).toHaveBeenCalledWith(row, expect.objectContaining({
        content: '<b>New text</b>', moderation_flags: ['html_markup'], approved: false,
        approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null,
      }), false);
    }
  });

  it('allows site-admin text edits without changing moderation and denies a resource admin editing another author', async () => {
    actor.playerId = moderator;
    await expect(service.edit(phase, id, 'New text')).rejects.toMatchObject({ code: 'wiki_note_edit_forbidden' });
    await expect(service.verdict(phase, id, 'approved', { state: 'pending', updatedAt: row.updated_at })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.moderationQueue(phase)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.reports(phase)).rejects.toMatchObject({ code: 'forbidden' });
    actor.isSiteAdmin = true;
    row = states.blocked;
    await service.edit(phase, id, 'Admin text');
    expect(storage.writeNote).toHaveBeenCalledWith(row, { content: 'Admin text', moderation_flags: [] }, false);
  });

  it.each(Object.keys(states) as (keyof typeof states)[])('moderator verdicts match the shared %s transitions', async (state) => {
    actor.isSiteAdmin = true;
    row = states[state];
    for (const target of ['approved', 'rejected'] as const) {
      storage.writeNote.mockClear();
      const action = service.verdict(phase, id, target, { state, updatedAt: row.updated_at });
      if (noteModerationMachine.can(state, target, 'admin')) {
        await action;
        expect(storage.writeNote).toHaveBeenCalledWith(row, expect.objectContaining({ approved: target === 'approved' }), false);
        if (target === 'approved') expect(storage.writeNote.mock.calls[0][1]).toMatchObject({ resubmission_blocked_at: null, resubmission_blocked_by: null });
      } else {
        const check = noteModerationMachine.check(state, target, 'admin');
        await expect(action).rejects.toMatchObject({ code: !check.ok && check.reason === 'actor_not_allowed' ? 'state_transition_forbidden' : 'state_transition_invalid' });
        expect(storage.writeNote).not.toHaveBeenCalled();
      }
    }
  });

  it('refuses stale decisions and distinguishes concurrent edits from deletion', async () => {
    actor.isSiteAdmin = true;
    await expect(service.verdict(phase, id, 'approved', { state: 'pending', updatedAt: 'old' })).rejects.toMatchObject({ code: 'wiki_note_changed' });
    expect(storage.writeNote).not.toHaveBeenCalled();
    storage.writeNote.mockResolvedValue(false);
    await expect(service.edit(phase, id, 'New text')).rejects.toMatchObject({ code: 'wiki_note_changed' });
    storage.getNote.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(service.remove(phase, id)).rejects.toMatchObject({ code: 'wiki_note_not_found' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('only the superadmin blocks rejected notes, with guarded unblock and idempotency', async () => {
    actor.isSiteAdmin = true;
    row = states.rejected;
    await expect(service.block(phase, id, true)).rejects.toMatchObject({ code: 'wiki_note_block_superadmin_only' });
    actor.isSuperadmin = true;
    await service.block(phase, id, true);
    expect(storage.writeNote).toHaveBeenCalledWith(row, expect.objectContaining({ resubmission_blocked_by: author }), false);
    row = states.blocked;
    storage.writeNote.mockClear();
    await service.block(phase, id, true);
    expect(storage.writeNote).not.toHaveBeenCalled();
    await service.block(phase, id, false);
    expect(storage.writeNote).toHaveBeenCalledWith(row, { resubmission_blocked_at: null, resubmission_blocked_by: null }, false);
    row = states.approved;
    await expect(service.block(phase, id, true)).rejects.toMatchObject({ code: 'wiki_note_block_not_rejected' });
  });

  it('permits author deletion even when blocked, but not another player', async () => {
    row = states.blocked;
    actor.playerId = moderator;
    await expect(service.remove(phase, id)).rejects.toMatchObject({ code: 'wiki_note_delete_forbidden' });
    actor.playerId = author;
    await service.remove(phase, id);
    expect(storage.writeNote).toHaveBeenCalledWith(row, {}, true);
  });

  it.each(['pending', 'rejected', 'blocked'] as const)('never reports or publishes %s text', async (state) => {
    row = states[state];
    expect(toPublicPhaseWikiNote(row)).toBeNull();
    await expect(service.report(phase, id, { reason: 'spam' })).rejects.toMatchObject({ code: 'wiki_note_not_found' });
    expect(storage.submitReport).not.toHaveBeenCalled();
  });

  it('publishes only allowlisted fields, even when storage returns an unexpected state', async () => {
    storage.listNotes.mockResolvedValue(Object.values(states));
    const result = await service.approved(phase, { type: 'move', name: 'tackle' });
    expect(result).toEqual([{
      id, phase_id: phase, entity_type: 'move', entity_name: 'tackle', author_name: base.author_name,
      content: base.content, created_at: base.created_at, updated_at: base.updated_at,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/approved_by|author_id|moderation|rejected|blocked|scope_|reporter/);
    expect(phaseWikiReportReceipt(report)).toEqual({ id, status: 'open', created_at: report.created_at, updated_at: report.updated_at });
    assertPublicPhase.mockRejectedValue(new Error('visibility read failed'));
    storage.listNotes.mockClear();
    await expect(service.approved(phase, { type: 'move', name: 'tackle' })).rejects.toThrow('visibility read failed');
    expect(storage.listNotes).not.toHaveBeenCalled();
  });

  it.each(['open', 'reviewed', 'dismissed'])('reopens the same reporter’s %s report with a version guard', async (status) => {
    row = states.approved;
    const prior = { ...report, status };
    storage.findReport.mockResolvedValue(prior);
    expect(await service.report(phase, id, { reason: 'other', details: 'Updated' })).toEqual(phaseWikiReportReceipt(report));
    expect(storage.submitReport).toHaveBeenCalledWith(row, author, 'other', 'Updated', prior);
  });

  it('closes reports with their status/version, refuses swaps, and does not close sibling reports', async () => {
    actor.isSiteAdmin = true;
    await service.closeReport(phase, id, 'reviewed');
    expect(storage.closeReport).toHaveBeenCalledExactlyOnceWith(report, 'reviewed');
    expect(storage.writeNote).not.toHaveBeenCalled();
    storage.getReport.mockResolvedValue({ ...report, status: 'reviewed' });
    await expect(service.closeReport(phase, id, 'dismissed')).rejects.toMatchObject({ code: 'state_transition_invalid' });
    storage.getReport.mockResolvedValue(report);
    storage.closeReport.mockResolvedValue(false);
    await expect(service.closeReport(phase, id, 'reviewed')).rejects.toMatchObject({ code: 'wiki_report_changed' });
    storage.getReport.mockResolvedValue(null);
    await expect(service.closeReport(phase, id, 'reviewed')).rejects.toMatchObject({ code: 'wiki_report_not_found' });
  });

  it('fails closed on live authorization and persistence errors', async () => {
    requireActor.mockRejectedValue(new Error('live access failed'));
    await expect(service.edit(phase, id, 'text')).rejects.toThrow('live access failed');
    expect(storage.getNote).not.toHaveBeenCalled();
    requireActor.mockResolvedValue(actor);
    storage.getNote.mockRejectedValue(new Error('database failed'));
    await expect(service.edit(phase, id, 'text')).rejects.toThrow('database failed');
    expect(storage.writeNote).not.toHaveBeenCalled();
    expect(noteModerationState(states.blocked)).toBe('blocked');
  });
});
