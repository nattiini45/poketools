import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
  getPlayerActivityCounts: vi.fn(),
  claimGuestPlayer: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '../route';
import { requireAdmin } from '@/lib/auth/helpers';
import {
  claimGuestPlayer,
  getPlayerActivityCounts,
  getPlayerById,
} from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const GUEST_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const SOURCE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';

const guestPlayer = {
  id: GUEST_ID,
  name: 'Guest Ash',
  discord_id: null,
  auth_user_id: null,
  is_guest: true,
};

const sourcePlayer = {
  id: SOURCE_ID,
  name: 'Real Ash',
  discord_id: '123456789',
  auth_user_id: 'auth-1',
  is_guest: false,
  status: 'active',
};

describe('POST /api/players/[id]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
    } as never);
    vi.mocked(getPlayerById).mockImplementation(async (id: string) => {
      if (id === GUEST_ID) return guestPlayer as never;
      if (id === SOURCE_ID) return sourcePlayer as never;
      return null;
    });
    vi.mocked(getPlayerActivityCounts).mockResolvedValue({
      seasonParticipations: 0,
      tournamentParticipations: 0,
      matchCount: 0,
      teamCount: 0,
      matchProposals: 0,
      draftPicks: 0,
      wikiNotes: 0,
      evolutionTrackerRows: 0,
    });
    vi.mocked(claimGuestPlayer).mockResolvedValue({
      ...guestPlayer,
      discord_id: sourcePlayer.discord_id,
      auth_user_id: sourcePlayer.auth_user_id,
      is_guest: false,
    } as never);
  });

  it('claims a guest account from an empty registered player', async () => {
    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(claimGuestPlayer).toHaveBeenCalledWith(GUEST_ID, SOURCE_ID);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'player.claim' }),
    );
  });

  it('rejects when source account has activity', async () => {
    vi.mocked(getPlayerActivityCounts).mockResolvedValue({
      seasonParticipations: 1,
      tournamentParticipations: 0,
      matchCount: 0,
      teamCount: 0,
      matchProposals: 0,
      draftPicks: 0,
      wikiNotes: 0,
      evolutionTrackerRows: 0,
    });

    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain('substitute');
    expect(json.code).toBe('SOURCE_HAS_ACTIVITY');
    expect(claimGuestPlayer).not.toHaveBeenCalled();
  });

  it('rejects claiming a guest onto itself with claim_same_player', async () => {
    const res = await POST(
      makeRequest({ source_player_id: GUEST_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('claim_same_player');
    expect(json.error).toBe('Guest and source account must be different players');
    expect(claimGuestPlayer).not.toHaveBeenCalled();
  });

  it('maps the RPC refusal for cascading source data (presets, AI generations, ...) to 409 SOURCE_HAS_ACTIVITY', async () => {
    // The activity pre-check passes (no matches/teams/...), but the RPC refuses because deleting the
    // source would cascade into its own rows. The claim must fail loudly, not report success.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(claimGuestPlayer).mockRejectedValue({
      code: '23503',
      message: `Source player ${SOURCE_ID} still owns rows in public.broadcast_presets (owner_id)`,
    });

    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SOURCE_HAS_ACTIVITY');
    expect(JSON.stringify(json)).not.toContain('broadcast_presets');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('maps a 23503 from the atomic claim to 409 SOURCE_HAS_ACTIVITY and writes no audit entry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(claimGuestPlayer).mockRejectedValue({
      code: '23503',
      message: 'update or delete on table "players" violates foreign key constraint',
    });

    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SOURCE_HAS_ACTIVITY');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each(['banned', 'suspended'])(
    'refuses a %s source with 409 SOURCE_NOT_ACTIVE before the claim (a claim must not lift a sanction)',
    async (status) => {
      vi.mocked(getPlayerById).mockImplementation(async (id: string) => {
        if (id === GUEST_ID) return guestPlayer as never;
        if (id === SOURCE_ID) return { ...sourcePlayer, status } as never;
        return null;
      });

      const res = await POST(
        makeRequest({ source_player_id: SOURCE_ID }),
        { params: makeParams({ id: GUEST_ID }) },
      );
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('SOURCE_NOT_ACTIVE');
      expect(claimGuestPlayer).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('maps a 55000 from the locked re-check (source sanctioned meanwhile) to 409 SOURCE_NOT_ACTIVE', async () => {
    vi.mocked(claimGuestPlayer).mockRejectedValue({
      code: '55000',
      message: 'Source player x is not in good standing (status banned)',
    });

    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SOURCE_NOT_ACTIVE');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('keeps other claim failures generic (500, no internals)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(claimGuestPlayer).mockRejectedValue({ code: '22023', message: 'Target player x is not a guest account' });

    const res = await POST(
      makeRequest({ source_player_id: SOURCE_ID }),
      { params: makeParams({ id: GUEST_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to link guest account');
  });
});
