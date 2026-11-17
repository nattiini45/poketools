import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseTeam } from './phase-team-fixture';
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPhaseTeamVisibilityFacts: vi.fn(), getPhaseTeamByShareToken: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getTeamByShareToken: vi.fn(), getTeamVisibilityFacts: vi.fn() }));
import { getPhaseTeamVisibilityFacts, getPhaseTeamByShareToken } from '@/lib/supabase/queries/phase-teams';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { filterPhaseTeamVisibility, resolveNativeTeamShare, checkPhaseTeamForkAccess } from '../phase-visibility';
import { PUBLIC_PHASE_TEAM_FIELDS, toPublicPhaseTeam, phaseTeamForShare } from '../phase-public-team';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPhaseTeamVisibilityFacts).mockResolvedValue(new Map());
  vi.mocked(getPhaseTeamByShareToken).mockResolvedValue(null);
  vi.mocked(getTeamByShareToken).mockResolvedValue(null);
});

describe('native phase visibility and public boundaries', () => {
  it('allowlists fields even when a runtime row carries share capabilities', () => {
    const row = { ...phaseTeam(), share_token: 'secret', share_enabled_at: 'now', extra: 'private' };
    expect(Object.keys(toPublicPhaseTeam(row)).sort()).toEqual([...PUBLIC_PHASE_TEAM_FIELDS].sort());
    expect(toPublicPhaseTeam(row)).not.toHaveProperty('tournament_id');
    expect(phaseTeamForShare(row)).not.toHaveProperty('share_token');
    expect(phaseTeamForShare(row).phase_id).toBe(row.phase_id);
  });

  it.each([{ viewerId: 'owner', isAdmin: false }, { viewerId: 'admin', isAdmin: true }])('does not read facts for %o', async (viewer) => {
    const team = phaseTeam();
    expect((await filterPhaseTeamVisibility([team], viewer))[0].pokemon).toEqual(team.pokemon);
    expect(getPhaseTeamVisibilityFacts).toHaveBeenCalledWith([]);
  });

  it('decides per row with native facts and independent redaction arrays', async () => {
    const rows = [phaseTeam({ id: 'planned' }), phaseTeam({ id: 'played', match_id: 'match' }), phaseTeam({ id: 'hidden', match_id: 'next' }), phaseTeam({ id: 'published', library_published_at: 'now' })];
    vi.mocked(getPhaseTeamVisibilityFacts).mockResolvedValue(new Map([
      ['planned', { match_status: 'completed', tournament_visibility: 'hidden_until_match' }],
      ['played', { match_status: 'completed', tournament_visibility: 'hidden_until_match' }],
      ['hidden', { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }],
    ]));
    const result = await filterPhaseTeamVisibility(rows, { viewerId: null, isAdmin: false });
    expect(result.map((row) => row.pokemon.length)).toEqual([6, 0, 6, 0]);
    expect(result[0].pokemon).not.toBe(result[2].pokemon);
    expect(rows[0].pokemon).toEqual([]);
    expect(getPhaseTeamVisibilityFacts).toHaveBeenCalledWith(['planned', 'played', 'hidden']);
  });

  it('uses an explicitly mixed bounded token resolver and rejects ambiguous identities', async () => {
    vi.mocked(getPhaseTeamByShareToken).mockResolvedValue(phaseTeam());
    expect(await resolveNativeTeamShare('token')).toEqual({ kind: 'phase', team: phaseTeam() });
    expect(getTeamByShareToken).toHaveBeenCalledWith('token');
    vi.mocked(getTeamByShareToken).mockResolvedValue({ id: 'other' } as NonNullable<Awaited<ReturnType<typeof getTeamByShareToken>>>);
    await expect(resolveNativeTeamShare('token')).rejects.toThrow('both team stores');
  });

  it('fork access preserves library consent and share authorization without owner shortcuts', async () => {
    expect(await checkPhaseTeamForkAccess(phaseTeam())).toBe('source_private');
    expect(await checkPhaseTeamForkAccess(phaseTeam(), 'invalid')).toBe('share_token_invalid');
    vi.mocked(getPhaseTeamByShareToken).mockResolvedValue(phaseTeam());
    expect(await checkPhaseTeamForkAccess(phaseTeam(), 'valid')).toBe('allowed');
    expect(await checkPhaseTeamForkAccess(phaseTeam({ library_published_at: 'now' }))).toBe('allowed');
  });
});
