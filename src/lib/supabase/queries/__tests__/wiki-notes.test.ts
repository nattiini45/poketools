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
  getApprovedNotes,
  listNotesForModeration,
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
    }));
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'note-1');
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