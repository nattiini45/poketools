import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAccess } from '@/lib/auth/helpers';
import type { FormatDefinitionMeta } from '../library-types';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  getFormatDefinitionMeta: vi.fn<(id: string) => Promise<FormatDefinitionMeta | null>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: mocks.getFormatDefinitionMeta }));

import { gateFormatDefinition } from '../gate';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';

function player(id: string): NonNullable<LiveAccess['player']> {
  return { playerId: id, name: `Player ${id}`, isAdmin: false, isResourceAdmin: true, isCreator: false } as NonNullable<LiveAccess['player']>;
}

function access(flags: Partial<LiveAccess> & { id?: string }): LiveAccess {
  return { player: player(flags.id ?? 'viewer'), isSiteAdmin: false, isAnyAdmin: true, isCreator: false, ...flags };
}

function meta(over: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta {
  return {
    id: ID,
    slug: 'cup-night',
    name: { base: 'en', en: { v: 'Cup night', s: 'human' } },
    description: null,
    kind: 'custom',
    owner_id: 'owner',
    visibility: 'private',
    forked_from: null,
    draft_rev: 1,
    current_version_id: null,
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gateFormatDefinition', () => {
  it('404s a malformed id before any read', async () => {
    await expect(gateFormatDefinition('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(gateFormatDefinition('')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(mocks.getFormatDefinitionMeta).not.toHaveBeenCalled();
  });

  it('is guard when signed out, without reading the definition', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'guard' });
    expect(mocks.getFormatDefinitionMeta).not.toHaveBeenCalled();
  });

  it('is guard for a signed-in player who is no admin', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: false }));
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'guard' });
    expect(mocks.getFormatDefinitionMeta).not.toHaveBeenCalled();
  });

  it('is guard for an admin flag without a player', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ player: null }));
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'guard' });
  });

  it('is guard for a banned or suspended admin (the live access gives no admin flag)', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: player('owner'), isSiteAdmin: false, isAnyAdmin: false, isCreator: false });
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta());
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'guard' });
    expect(mocks.getFormatDefinitionMeta).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'owner' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(null);
    await expect(gateFormatDefinition(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getFormatDefinitionMeta).toHaveBeenCalledWith(ID);
  });

  it('is forbidden for another admin\'s private format', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'someone-else' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ visibility: 'private' }));
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'forbidden' });
  });

  it.each(['league', 'gallery'] as const)('lets another admin view a %s format but not edit it', async (visibility) => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'someone-else' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ visibility }));
    const gate = await gateFormatDefinition(ID);
    expect(gate.kind).toBe('ok');
    if (gate.kind !== 'ok') return;
    expect(gate.canEdit).toBe(false);
    expect(gate.actor).toEqual({ playerId: 'someone-else', isAdmin: false });
  });

  it('lets the owner edit, from the live player', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'owner' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta());
    const gate = await gateFormatDefinition(ID);
    expect(gate).toMatchObject({ kind: 'ok', canEdit: true, actor: { playerId: 'owner', isAdmin: false } });
    if (gate.kind === 'ok') {
      expect(gate.definition.id).toBe(ID);
      expect(gate.player.playerId).toBe('owner');
    }
  });

  it('lets a site admin view and edit any format, including a private one of someone else', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'boss', isSiteAdmin: true }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ visibility: 'private', owner_id: 'owner' }));
    expect(await gateFormatDefinition(ID)).toMatchObject({ kind: 'ok', canEdit: true, actor: { playerId: 'boss', isAdmin: true } });
  });

  it('decides the admin flag from the live access, not from the player\'s own copy', async () => {
    const stale = { ...player('someone-else'), isAdmin: true };
    mocks.getLiveAccess.mockResolvedValue({ player: stale, isSiteAdmin: false, isAnyAdmin: true, isCreator: false });
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ visibility: 'private' }));
    expect(await gateFormatDefinition(ID)).toEqual({ kind: 'forbidden' });
  });

  it('only a site admin edits a preset row; its owner does not', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ kind: 'preset', visibility: 'gallery' }));
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'owner' }));
    expect(await gateFormatDefinition(ID)).toMatchObject({ kind: 'ok', canEdit: false });
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'boss', isSiteAdmin: true }));
    expect(await gateFormatDefinition(ID)).toMatchObject({ kind: 'ok', canEdit: true });
  });

  it('fails closed when a read fails', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'owner' }));
    mocks.getFormatDefinitionMeta.mockRejectedValue(new Error('db down'));
    await expect(gateFormatDefinition(ID)).rejects.toThrow('db down');
    mocks.getLiveAccess.mockRejectedValue(new Error('auth down'));
    await expect(gateFormatDefinition(ID)).rejects.toThrow('auth down');
  });

  it('reads no draft body', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ id: 'owner' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta());
    const gate = await gateFormatDefinition(ID);
    expect(JSON.stringify(gate)).not.toContain('current_draft');
    expect(mocks.getFormatDefinitionMeta).toHaveBeenCalledTimes(1);
  });
});
