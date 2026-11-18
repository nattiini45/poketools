import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { POST as move } from '../route';
import { POST as impact } from '../impact/route';

const q = vi.hoisted(() => ({
  requireRulesetViewer: vi.fn(), checkRateLimit: vi.fn(), requireOpenPhaseRouteMode: vi.fn(),
  getPhasePinStates: vi.fn(), repinPhaseTarget: vi.fn(), isPhaseAdminFor: vi.fn(),
  getRulesetVersion: vi.fn(), listRulesetVersions: vi.fn(), repinTarget: vi.fn(),
  getPinTargetStates: vi.fn(), getRulesetById: vi.fn(), isResourceAdminFor: vi.fn(),
  listPhaseTeamsForPinImpact: vi.fn(), listTeamsForPinImpact: vi.fn(),
  expirePhaseReads: vi.fn(), expireTournamentReads: vi.fn(), expireSeasonReads: vi.fn(),
  logAuditEvent: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => q);
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/ruleset-studio/guards', () => q);
vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) { super(message); }
  },
}));
vi.mock('@/lib/utils/rate-limit', () => q);
vi.mock('@/lib/league-phase/route-mode', () => q);
vi.mock('@/lib/supabase/queries/phase-admins', () => q);
vi.mock('@/lib/supabase/queries/resource-admins', () => q);
vi.mock('@/lib/supabase/queries/phase-ruleset-pins', () => q);
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => q);
vi.mock('@/lib/supabase/queries/rulesets', () => q);
vi.mock('@/lib/supabase/queries/phase-teams', () => q);
vi.mock('@/lib/supabase/queries/teams', () => q);
vi.mock('@/lib/revalidation', () => q);
vi.mock('@/lib/audit/log', () => q);

const phaseId = '10000000-0000-4000-8000-000000000001';
const eventId = '10000000-0000-4000-8000-000000000002';
const phase = {
  id: phaseId, kind: 'phase', season_id: 'league', status: 'active',
  name: 'Finals', ruleset_id: 'v1', archived: false,
};
const input = { to_version_no: 2, targets: [{ id: phaseId, kind: 'phase' }] };
const route = { params: Promise.resolve({ id: 'definition' }) };
const call = (post: (request: NextRequest, context: typeof route) => Promise<Response>, body: unknown) => post(new NextRequest('http://localhost/pins', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), route);
const ruleset = (id: string) => makeRuleset({
  id, bans: { pokemon: id === 'v2' ? ['Garchomp'] : [], moves: [], items: [], abilities: [] },
});

beforeEach(() => {
  vi.resetAllMocks();
  q.requireRulesetViewer.mockResolvedValue({ player: { playerId: 'organizer', name: 'Organizer', isAdmin: false }, definition: { id: 'definition', slug: 'fixture' } });
  q.checkRateLimit.mockResolvedValue({ allowed: true });
  q.requireOpenPhaseRouteMode.mockResolvedValue('phase');
  q.getPhasePinStates.mockResolvedValue([phase]);
  q.isPhaseAdminFor.mockResolvedValue(true);
  q.isResourceAdminFor.mockResolvedValue(true);
  q.getPinTargetStates.mockResolvedValue([]);
  q.repinPhaseTarget.mockResolvedValue(true);
  q.repinTarget.mockResolvedValue(true);
  q.listRulesetVersions.mockResolvedValue([{ id: 'v1', version_no: 1 }, { id: 'v2', version_no: 2 }]);
  q.getRulesetVersion.mockImplementation(async (_id: string, version_no: number) => ({
    id: `v${version_no}`, version_no, resolved: ruleset(`v${version_no}`).rules,
  }));
  q.getRulesetById.mockImplementation(async (id: string) => ruleset(id));
  q.listPhaseTeamsForPinImpact.mockResolvedValue({ teams: [{ id: 'team', player_id: 'player', pokemon: [makeSet()] }], truncated: false });
  q.listTeamsForPinImpact.mockResolvedValue({ teams: [], truncated: false });
});

it('validates and previews native phase teams, then moves the confirmed native pin and records its owner', async () => {
  const preview = await call(impact, input);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ data: { checked: 1, would_break: 1, targets: [{ id: phaseId, kind: 'phase' }] } });
  expect(q.listTeamsForPinImpact).not.toHaveBeenCalled();
  const unconfirmed = await call(move, input);
  expect(unconfirmed.status).toBe(409);
  expect(await unconfirmed.json()).toMatchObject({ code: 'ruleset_pin_confirm_required' });
  expect(q.repinPhaseTarget).not.toHaveBeenCalled();
  const moved = await call(move, { ...input, confirm_started: [phaseId] });
  expect(moved.status).toBe(200);
  expect(await moved.json()).toMatchObject({ data: { moved: [{ kind: 'phase', id: phaseId, season_id: 'league' }] } });
  expect(q.repinPhaseTarget).toHaveBeenCalledExactlyOnceWith(phase, 'v2');
  expect(q.expirePhaseReads).toHaveBeenCalledExactlyOnceWith(phaseId, 'league');
  expect(q.expireTournamentReads).not.toHaveBeenCalled();
  expect(q.logAuditEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'ruleset.pin', resource_type: 'phase', resource_id: phaseId }));
});

it('refuses native phase targets without any target access in legacy or frozen mode', async () => {
  q.requireOpenPhaseRouteMode.mockResolvedValueOnce('legacy').mockRejectedValueOnce(
    new UserFacingError('League phases are temporarily unavailable during maintenance.', { code: 'phase_storage_unavailable', status: 503 }),
  );
  expect((await call(impact, input)).status).toBe(404);
  expect((await call(move, input)).status).toBe(503);
  expect(q.getPhasePinStates).not.toHaveBeenCalled();
  expect(q.getPinTargetStates).not.toHaveBeenCalled();
  expect(q.repinPhaseTarget).not.toHaveBeenCalled();
});

it('retains the old standalone dispatch without reading a phase mode or its tables', async () => {
  q.getPinTargetStates.mockResolvedValue([{ ...phase, kind: 'tournament', id: eventId, season_id: null, status: 'upcoming' }]);
  const legacy = { ...input, targets: [{ kind: 'tournament', id: eventId }] };
  expect((await call(impact, legacy)).status).toBe(200);
  expect((await call(move, legacy)).status).toBe(200);
  expect(q.requireOpenPhaseRouteMode).not.toHaveBeenCalled();
  expect(q.getPhasePinStates).not.toHaveBeenCalled();
  expect(q.repinTarget).toHaveBeenCalledExactlyOnceWith('tournament', eventId, 'v1', 'v2');
});

it('refuses a mixed request that names a league-backed tournament as a native target', async () => {
  q.getPinTargetStates.mockResolvedValue([{ ...phase, kind: 'tournament', id: eventId }]);
  const mixed = { ...input, targets: [...input.targets, { id: eventId, kind: 'tournament' }] };
  expect((await call(move, mixed)).status).toBe(404);
  expect(q.repinPhaseTarget).not.toHaveBeenCalled();
  expect(q.repinTarget).not.toHaveBeenCalled();
});
