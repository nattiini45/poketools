import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '@/types/auth';
import type { ListFormatsArgs } from '@/lib/supabase/queries/format-definitions';
import type { FormatDefinitionSummary } from '../library-types';

const mocks = vi.hoisted(() => ({
  listFormatDefinitions: vi.fn<(args: ListFormatsArgs) => Promise<{ items: FormatDefinitionSummary[]; total: number }>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ listFormatDefinitions: mocks.listFormatDefinitions }));

import { loadAttachCandidates } from '../attach-candidates';

const PLAYER: SessionPlayer = {
  playerId: 'me',
  name: 'Me',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

let counter = 0;

function row(over: Partial<FormatDefinitionSummary> = {}): FormatDefinitionSummary {
  counter += 1;
  return {
    id: `def-${counter}`,
    slug: `format-${counter}`,
    name: { base: 'en', en: { v: `Format ${counter}`, s: 'human' } },
    description: null,
    kind: 'custom',
    visibility: 'league',
    forked_from: null,
    draft_rev: 4,
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T10:00:00Z',
    owner: { id: 'someone', name: 'Someone' },
    current_version: { id: `v-${counter}`, version_no: 2, content_hash: 'a'.repeat(64), created_at: '2026-10-24T10:00:00Z' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
});

describe('loadAttachCandidates', () => {
  it('asks the library for the live player\'s page of everything they may see', async () => {
    mocks.listFormatDefinitions.mockResolvedValue({ items: [], total: 0 });
    await loadAttachCandidates(PLAYER);
    expect(mocks.listFormatDefinitions).toHaveBeenCalledTimes(1);
    expect(mocks.listFormatDefinitions).toHaveBeenCalledWith({
      actor: { playerId: 'me', isAdmin: false },
      scope: 'all',
      limit: 100,
      offset: 0,
    });
  });

  it('passes the live site admin flag', async () => {
    mocks.listFormatDefinitions.mockResolvedValue({ items: [], total: 0 });
    await loadAttachCandidates({ ...PLAYER, isAdmin: true });
    expect(mocks.listFormatDefinitions.mock.calls[0][0].actor).toEqual({ playerId: 'me', isAdmin: true });
  });

  it('keeps only formats with a published version', async () => {
    const draftOnly = row({ current_version: null, visibility: 'league' });
    const published = row();
    mocks.listFormatDefinitions.mockResolvedValue({ items: [draftOnly, published], total: 2 });
    const { items, capped } = await loadAttachCandidates(PLAYER);
    expect(items.map((i) => i.id)).toEqual([published.id]);
    expect(capped).toBe(false);
  });

  it('keeps what the viewer may attach: their own, shared and gallery formats', async () => {
    const mine = row({ visibility: 'private', owner: { id: 'me', name: 'Me' } });
    const shared = row({ visibility: 'league' });
    const gallery = row({ visibility: 'gallery', owner: null });
    const someoneElsesPrivate = row({ visibility: 'private' });
    mocks.listFormatDefinitions.mockResolvedValue({ items: [mine, shared, gallery, someoneElsesPrivate], total: 4 });
    const { items } = await loadAttachCandidates(PLAYER);
    expect(items.map((i) => i.id)).toEqual([mine.id, shared.id, gallery.id]);
    expect(items.map((i) => i.mine)).toEqual([true, false, false]);
    expect(items.map((i) => i.ownerName)).toEqual(['Me', 'Someone', null]);
  });

  it('maps the fields the picker shows and nothing else', async () => {
    const source = row({ visibility: 'gallery' });
    mocks.listFormatDefinitions.mockResolvedValue({ items: [source], total: 1 });
    const { items } = await loadAttachCandidates(PLAYER);
    expect(items).toEqual([
      {
        id: source.id,
        slug: source.slug,
        name: source.name,
        version_no: 2,
        content_hash: 'a'.repeat(64),
        visibility: 'gallery',
        ownerName: 'Someone',
        mine: false,
      },
    ]);
  });

  it('serialises without an owner id, a draft, a description or a players row', async () => {
    const source = row({ owner: { id: 'secret-owner-id', name: 'Owner Name' }, description: { base: 'en', en: { v: 'private notes', s: 'human' } } });
    mocks.listFormatDefinitions.mockResolvedValue({ items: [source], total: 1 });
    const json = JSON.stringify(await loadAttachCandidates(PLAYER));
    expect(json).not.toContain('secret-owner-id');
    expect(json).not.toContain('owner_id');
    expect(json).not.toContain('current_draft');
    expect(json).not.toContain('draft_rev');
    expect(json).not.toContain('private notes');
    expect(json).not.toContain('players');
    expect(json).toContain('Owner Name');
  });

  it('reports a capped list when there are more than 100 formats', async () => {
    mocks.listFormatDefinitions.mockResolvedValue({ items: [row()], total: 101 });
    expect((await loadAttachCandidates(PLAYER)).capped).toBe(true);
    mocks.listFormatDefinitions.mockResolvedValue({ items: [row()], total: 100 });
    expect((await loadAttachCandidates(PLAYER)).capped).toBe(false);
  });

  it('fails closed when the read fails', async () => {
    mocks.listFormatDefinitions.mockRejectedValue(new Error('db down'));
    await expect(loadAttachCandidates(PLAYER)).rejects.toThrow('db down');
  });
});
