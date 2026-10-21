import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  createPlayersBatch: vi.fn(),
  getPlayersByDiscordIds: vi.fn(),
  upsertPlayersByDiscordId: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/admin/players/import/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { createPlayersBatch, getPlayersByDiscordIds, upsertPlayersByDiscordId } from '@/lib/supabase/queries/players';

const admin = { playerId: 'admin-1', name: 'Admin' };

function csvRequest(csv: string, mode = 'insert') {
  return new NextRequest(`http://localhost/api/admin/players/import?mode=${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body: csv,
  });
}

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/players/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/players/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(admin as never);
    vi.mocked(getPlayersByDiscordIds).mockResolvedValue(new Map());
    vi.mocked(createPlayersBatch).mockResolvedValue([]);
    vi.mocked(upsertPlayersByDiscordId).mockResolvedValue([]);
  });

  it('imports CSV players and reports existing duplicates in insert mode', async () => {
    const existing = new Map<string, unknown>();
    existing.set('111111111111111111', { id: 'player-1', discord_id: '111111111111111111' });
    vi.mocked(getPlayersByDiscordIds).mockResolvedValue(existing as never);
    vi.mocked(createPlayersBatch).mockResolvedValueOnce([
      {
        id: 'player-2',
        name: 'Misty',
        discord_id: '222222222222222222',
        ps_username: 'misty',
        champions_username: '',
        is_admin: false,
        is_creator: false,
        joined_date: '',
        avatar_url: null,
        avatar_config: null,
        status: 'active',
        suspended_until: null,
        ban_reason: null,
        created_at: '',
        updated_at: '',
      },
    ] as never);

    const res = await POST(csvRequest('name,discord_id,ps_username\nAsh,111111111111111111,ash\nMisty,222222222222222222,misty'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.imported).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.results).toContainEqual(
      expect.objectContaining({
        discord_id: '111111111111111111',
        action: 'skipped',
        error: 'Player with discord_id already exists',
        code: 'player_import_discord_id_exists',
      })
    );
    expect(createPlayersBatch).toHaveBeenCalledWith([
      expect.objectContaining({ discord_id: '222222222222222222' }),
    ]);
  });

  it('upserts JSON player imports', async () => {
    const res = await POST(jsonRequest({
      mode: 'upsert',
      players: [{ name: 'Brock', discord_id: '333333333333333333', ps_username: 'brock' }],
    }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(upsertPlayersByDiscordId).toHaveBeenCalledWith([
      expect.objectContaining({ discord_id: '333333333333333333' }),
    ]);
  });

  it('skips a discord_id repeated in one payload with player_import_duplicate_discord_id', async () => {
    const res = await POST(jsonRequest({
      mode: 'upsert',
      players: [
        { name: 'Brock', discord_id: '333333333333333333' },
        { name: 'Brock Again', discord_id: '333333333333333333' },
      ],
    }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.results).toContainEqual(
      expect.objectContaining({
        name: 'Brock Again',
        action: 'skipped',
        error: 'Duplicate discord_id in import payload',
        code: 'player_import_duplicate_discord_id',
      })
    );
  });

  it('returns 400 for invalid import bodies', async () => {
    const res = await POST(jsonRequest({ players: [{ name: '', discord_id: 'bad' }] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(createPlayersBatch).not.toHaveBeenCalled();
  });
});