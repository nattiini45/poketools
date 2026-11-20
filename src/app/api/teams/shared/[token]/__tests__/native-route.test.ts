import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A share token that names a native phase team resolves through the same allowlist the legacy link answers with, so a
 * link minted before cutover keeps working after it.
 */

const m = vi.hoisted(() => ({
  resolveSharedTeam: vi.fn(),
}));

vi.mock('@/lib/team/shared-team', () => ({ resolveSharedTeam: m.resolveSharedTeam }));
vi.mock('@/lib/utils/rate-limit', () => ({
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 })),
  rateLimitedResponse: vi.fn(),
}));

import { GET } from '../route';

const token = 'af000000-0000-4000-8000-000000000001';
const teamId = 'af000000-0000-4000-8000-000000000002';

const get = (value = token) =>
  GET(new NextRequest(`http://localhost/api/teams/shared/${value}`), { params: Promise.resolve({ token: value }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/teams/shared/[token]', () => {
  it('answers a native phase team through the shared allowlist, without the token', async () => {
    m.resolveSharedTeam.mockResolvedValue({
      kind: 'phase',
      team: {
        id: teamId,
        phase_id: 'phase-1',
        pokemon: [{ species: 'Pikachu' }, { species: '' }],
        library_title: 'Rain',
        library_description: 'Fast',
        created_at: '2026-11-01T00:00:00Z',
        share_token: 'secret',
      },
    });
    const json = await (await get()).json();
    expect(json).toEqual({
      success: true,
      team: {
        id: teamId,
        pokemon: [{ species: 'Pikachu' }],
        library_title: 'Rain',
        library_description: 'Fast',
        tournament_id: null,
        created_at: '2026-11-01T00:00:00Z',
      },
    });
    expect(JSON.stringify(json)).not.toContain('secret');
    expect(m.resolveSharedTeam).toHaveBeenCalledExactlyOnceWith(token);
  });

  it('keeps the legacy answer for a legacy row', async () => {
    m.resolveSharedTeam.mockResolvedValue({
      kind: 'team',
      team: { id: teamId, tournament_id: 'tourney-1', pokemon: [{ species: 'Pikachu' }], library_title: null,
        library_description: null, created_at: '2026-11-01T00:00:00Z' },
    });
    expect((await (await get()).json()).team).toMatchObject({ id: teamId, tournament_id: 'tourney-1' });
  });

  it('answers the coded 404 for a token neither store holds, and the coded 400 for a malformed one', async () => {
    m.resolveSharedTeam.mockResolvedValue(null);
    const missing = await get();
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'team_shared_not_found' });
    const invalid = await get('not-a-token');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'team_share_token_invalid' });
  });
});
