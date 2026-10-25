import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBuilder = vi.hoisted(() => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'not', 'order', 'range', 'limit']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn();
  return builder;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  approveNote,
  createNote,
  createNoteReport,
  getApprovedNotes,
  listNoteReports,
  listNotesForModeration,
  setNoteResubmissionBlock,
  updateNote,
} from '../wiki-notes';

const noteRow = {
  id: 'note-1',
  entity_type: 'pokemon',
  entity_name: 'Pikachu',
  author_id: 'player-1',
  content: 'Useful on rain teams.',
  scope_type: 'global',
  scope_id: null,
  approved: false,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  moderation_flags: [],
  created_at: '2026-04-15T00:00:00.000Z',
  updated_at: '2026-04-15T00:00:00.000Z',
};

describe('wiki note moderation queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(mockBuilder)) {
      mock.mockReturnValue(mockBuilder);
    }
  });

  it('creates notes as pending with automated moderation flags', async () => {
    mockBuilder.single.mockResolvedValue({
      data: { ...noteRow, moderation_flags: ['too_many_links'] },
      error: null,
    });

    const result = await createNote('player-1', {
      entity_type: 'pokemon',
      entity_name: 'Pikachu',
      content: 'https://a.test https://b.test https://c.test https://d.test',
    });

    expect(mockBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      approved: false,
      moderation_flags: ['too_many_links'],
    }));
    expect(result.approved).toBe(false);
  });

  it('lists only pending, unrejected notes for the moderation queue', async () => {
    mockBuilder.is.mockReturnValue({ data: [noteRow], error: null });

    const result = await listNotesForModeration({ status: 'pending', limit: 25, offset: 5 });

    expect(mockBuilder.eq).toHaveBeenCalledWith('approved', false);
    expect(mockBuilder.is).toHaveBeenCalledWith('rejected_at', null);
    expect(mockBuilder.range).toHaveBeenCalledWith(5, 29);
    expect(result).toHaveLength(1);
  });

  it('marks notes approved with moderator metadata', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await approveNote('note-1', 'admin-1');

    expect(mockBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      approved: true,
      approved_by: 'admin-1',
      rejected_at: null,
      // approving lifts a resubmission block: an approved note is not rejected
      resubmission_blocked_at: null,
      resubmission_blocked_by: null,
    }));
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'note-1');
  });

  it('exposes the block fields only on a blocked note, so the public note shape is unchanged', async () => {
    mockBuilder.limit.mockResolvedValue({ data: [{ ...noteRow, approved: true }], error: null });
    const [plain] = await getApprovedNotes('pokemon', 'Pikachu');
    expect(plain).not.toHaveProperty('resubmission_blocked_at');
    expect(plain).not.toHaveProperty('resubmission_blocked_by');

    mockBuilder.not.mockResolvedValue({
      data: [{
        ...noteRow,
        rejected_at: '2026-04-16T00:00:00.000Z',
        resubmission_blocked_at: '2026-04-17T00:00:00.000Z',
        resubmission_blocked_by: 'super-1',
      }],
      error: null,
    });
    const [blocked] = await listNotesForModeration({ status: 'rejected' });
    expect(blocked.resubmission_blocked_at).toBe('2026-04-17T00:00:00.000Z');
    expect(blocked.resubmission_blocked_by).toBe('super-1');
  });

  describe('updateNote', () => {
    const noteId = 'note-1';

    it('puts the note back in the pending queue in one UPDATE when its author edits it', async () => {
      mockBuilder.select.mockResolvedValue({ data: [{ id: noteId }], error: null });

      const applied = await updateNote(noteId, 'https://a.test https://b.test https://c.test https://d.test', 'author');
      expect(applied).toBe(true);

      expect(mockBuilder.update).toHaveBeenCalledTimes(1);
      expect(mockBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
        content: 'https://a.test https://b.test https://c.test https://d.test',
        moderation_flags: ['too_many_links'],
        approved: false,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
      }));
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', noteId);
    });

    it('filters an author edit on "not blocked", so a block that landed a moment ago still wins', async () => {
      mockBuilder.select.mockResolvedValue({ data: [], error: null });

      const applied = await updateNote(noteId, 'Edit after the block', 'author');

      expect(mockBuilder.is).toHaveBeenCalledWith('resubmission_blocked_at', null);
      expect(applied).toBe(false);
    });

    it('keeps the status when a moderator edits the note', async () => {
      mockBuilder.select.mockResolvedValue({ data: [{ id: noteId }], error: null });

      await updateNote(noteId, 'Fixed typo', 'moderator');
      expect(mockBuilder.is).not.toHaveBeenCalled();

      expect(mockBuilder.update).toHaveBeenCalledTimes(1);
      const payload = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toMatchObject({ content: 'Fixed typo', moderation_flags: [] });
      for (const key of ['approved', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'rejection_reason']) {
        expect(payload).not.toHaveProperty(key);
      }
    });

    it('rethrows a Supabase error', async () => {
      mockBuilder.select.mockResolvedValue({ data: null, error: { message: 'boom' } });

      await expect(updateNote(noteId, 'x', 'author')).rejects.toEqual({ message: 'boom' });
    });
  });

  describe('setNoteResubmissionBlock', () => {
    it('blocks only a rejected, not-approved note and records who did it', async () => {
      mockBuilder.select.mockResolvedValue({ data: [{ id: 'note-1' }], error: null });

      const changed = await setNoteResubmissionBlock('note-1', true, 'super-1');

      expect(changed).toBe(true);
      const payload = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.resubmission_blocked_by).toBe('super-1');
      expect(typeof payload.resubmission_blocked_at).toBe('string');
      // the note stays rejected: the block writes none of the verdict fields
      for (const key of ['approved', 'rejected_at', 'rejected_by', 'rejection_reason']) {
        expect(payload).not.toHaveProperty(key);
      }
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'note-1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('approved', false);
      expect(mockBuilder.not).toHaveBeenCalledWith('rejected_at', 'is', null);
    });

    it('reports false when no row matched (the note was approved, re-queued or deleted meanwhile)', async () => {
      mockBuilder.select.mockResolvedValue({ data: [], error: null });

      expect(await setNoteResubmissionBlock('note-1', true, 'super-1')).toBe(false);
    });

    it('lifts a block without any status filter', async () => {
      mockBuilder.select.mockResolvedValue({ data: [{ id: 'note-1' }], error: null });

      expect(await setNoteResubmissionBlock('note-1', false, 'super-1')).toBe(true);

      expect(mockBuilder.update).toHaveBeenCalledWith({ resubmission_blocked_at: null, resubmission_blocked_by: null });
      expect(mockBuilder.eq).toHaveBeenCalledTimes(1);
      expect(mockBuilder.not).not.toHaveBeenCalled();
    });

    it('rethrows a Supabase error', async () => {
      mockBuilder.select.mockResolvedValue({ data: null, error: { message: 'boom' } });

      await expect(setNoteResubmissionBlock('note-1', true, 'super-1')).rejects.toEqual({ message: 'boom' });
    });
  });

  describe('note reports', () => {
    const reportRow = {
      id: 'report-1',
      note_id: 'note-1',
      reporter_id: 'player-2',
      reason: 'spam',
      details: null,
      status: 'open',
      created_at: '2026-04-16T00:00:00.000Z',
      updated_at: '2026-04-16T00:00:00.000Z',
      wiki_notes: {
        id: 'note-1',
        entity_type: 'pokemon',
        entity_name: 'Pikachu',
        content: 'Useful on rain teams.',
        author_id: 'player-1',
        approved: true,
      },
    };

    it('selects and exposes whether the reported note is public', async () => {
      mockBuilder.range.mockReturnValue({ data: [reportRow], error: null });

      const reports = await listNoteReports();

      expect(mockBuilder.select.mock.calls[0][0]).toContain('author_id, approved)');
      expect(reports[0].note?.approved).toBe(true);
    });

    it('selects the approved flag when a report is created', async () => {
      mockBuilder.single.mockResolvedValue({ data: reportRow, error: null });

      const report = await createNoteReport('player-2', 'note-1', 'spam');

      expect(mockBuilder.select.mock.calls[0][0]).toContain('author_id, approved)');
      expect(report.note?.approved).toBe(true);
    });
  });

  it('public reads request only approved notes', async () => {
    mockBuilder.limit.mockReturnValue({ data: [{ ...noteRow, approved: true }], error: null });

    const result = await getApprovedNotes('pokemon', 'Pikachu');

    expect(mockBuilder.eq).toHaveBeenCalledWith('entity_type', 'pokemon');
    expect(mockBuilder.eq).toHaveBeenCalledWith('entity_name', 'Pikachu');
    expect(mockBuilder.eq).toHaveBeenCalledWith('approved', true);
    expect(result[0].approved).toBe(true);
  });
});