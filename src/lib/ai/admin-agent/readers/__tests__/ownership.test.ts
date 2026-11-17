import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '@/types/auth';
import type { AdminScope } from '@/lib/auth/admin-scope';
import type { PhaseAdminScope } from '@/lib/auth/phase-access';
import { createAdminAgentOwnershipReader } from '../ownership';
import { validateAgentResourceRefs, type AgentResourceRef, type CompetitionRef } from '@/lib/ai/agent/resource-ref';
import { getAgentOwnershipGraph } from '@/lib/supabase/queries/agent-ownership';

const persistence = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as { table: string; columns: string; ids: string[] }[],
  errorTable: '',
  error: new Error('owner read failed'),
  nullTable: '',
}));
const auth = vi.hoisted(() => ({ live: vi.fn(), phase: vi.fn(), legacy: vi.fn() }));
vi.mock('@/lib/auth/phase-access', () => ({ requirePhaseAwareAdmin: auth.live, getPhaseAdminScope: auth.phase }));
vi.mock('@/lib/auth/admin-scope', () => ({ getAdminScope: auth.legacy }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (column: string, ids: string[]) => {
          expect(column).toBe('id');
          persistence.calls.push({ table, columns, ids });
          if (persistence.errorTable === table) return { data: null, error: persistence.error };
          if (persistence.nullTable === table) return { data: null, error: null };
          const rows = (persistence.rows[table] ?? []).filter((row) => ids.includes(String(row.id)));
          return {
            data: rows.map((row) => Object.fromEntries(columns.split(',').map((key) => [key.trim(), row[key.trim()]]))),
            error: null,
          };
        },
      }),
    }),
  },
}));

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const phase: CompetitionRef = { kind: 'phase', seasonId: uid(1), phaseId: uid(2) };
const tournament: CompetitionRef = { kind: 'tournament', tournamentId: uid(2) };
const player: SessionPlayer = {
  playerId: uid(10), name: 'Example admin', isAdmin: true, isResourceAdmin: false,
  isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
};
const phaseScope: PhaseAdminScope = { playerId: player.playerId, isSiteAdmin: true, seasonIds: null, phaseIds: null };
const legacyScope: AdminScope = { playerId: player.playerId, isSiteAdmin: true, seasonIds: null, tournamentIds: null };
const ref = (owner: CompetitionRef, resource: AgentResourceRef['resource'], id = uid(3)): AgentResourceRef =>
  resource === 'competition' ? { resource, owner } : { resource, owner, id };
const all = (owner: CompetitionRef) => [ref(owner, 'competition'), ref(owner, 'round'), ref(owner, 'match', uid(4)), ref(owner, 'game', uid(5))];
const check = (refs: unknown) => validateAgentResourceRefs(refs, createAdminAgentOwnershipReader());

beforeEach(() => {
  vi.resetAllMocks();
  persistence.calls = [];
  persistence.errorTable = '';
  persistence.nullTable = '';
  persistence.rows = {
    seasons: [{ id: uid(1) }],
    league_phases: [{ id: uid(2), season_id: uid(1) }],
    phase_rounds: [{ id: uid(3), phase_id: uid(2) }],
    phase_matches: [{ id: uid(4), phase_id: uid(2), round_id: uid(3), notes: 'private' }],
    phase_games: [{ id: uid(5), match_id: uid(4) }],
    tournaments: [{ id: uid(2), season_id: null }],
    rounds: [{ id: uid(3), tournament_id: uid(2) }],
    matches: [{ id: uid(4), tournament_id: uid(2), round_id: uid(3), notes: 'private' }],
    games: [{ id: uid(5), match_id: uid(4) }],
  };
  auth.live.mockResolvedValue(player);
  auth.phase.mockResolvedValue(phaseScope);
  auth.legacy.mockResolvedValue(legacyScope);
});

describe('authoritative dormant admin ownership reader', () => {
  it('reconstructs all resource chains independently despite identical UUIDs in both stores', async () => {
    const refs = [...all(phase), ...all(tournament)];
    const original = JSON.stringify(refs);
    expect(await check(refs)).toEqual({ ok: true, refs });
    const resolved = await createAdminAgentOwnershipReader().resolve(refs);
    expect(resolved).toEqual(refs);
    expect(resolved[0]).not.toBe(refs[0]);
    expect(JSON.stringify(resolved)).not.toContain('private');
    expect(JSON.stringify(refs)).toBe(original);
    expect(auth.phase).toHaveBeenCalledWith(player);
    expect(auth.legacy).toHaveBeenCalledWith(player);
  });

  it.each(['competition', 'round', 'match', 'game'] as const)('rebuilds the actual league for a %s instead of echoing it', async (resource) => {
    const requested = ref({ ...phase, seasonId: uid(9) }, resource, resource === 'game' ? uid(5) : resource === 'match' ? uid(4) : uid(3));
    expect(await check([requested])).toEqual({ ok: false, reason: 'ownership_mismatch' });
    const [actual] = await createAdminAgentOwnershipReader().resolve([requested]);
    expect(actual?.owner).toEqual(phase);
  });

  it.each([phase, tournament])('checks the actual competition for children: $kind', async (owner) => {
    const requestedOwner = owner.kind === 'phase' ? { ...owner, phaseId: uid(9) } : { ...owner, tournamentId: uid(9) };
    expect(await check([ref(requestedOwner, 'match', uid(4))])).toEqual({ ok: false, reason: 'ownership_mismatch' });
  });

  it.each(['seasons', 'league_phases', 'phase_rounds', 'phase_matches', 'phase_games', 'tournaments', 'rounds', 'matches', 'games'])(
    'refuses missing parent or child in %s without falling back', async (table) => {
      persistence.rows[table] = [];
      const owner = ['tournaments', 'rounds', 'matches', 'games'].includes(table) ? tournament : phase;
      expect(await check([ref(owner, 'game', uid(5))])).toEqual({ ok: false, reason: 'ownership_unavailable' });
      const tables = persistence.calls.map((call) => call.table);
      expect(tables).not.toContain(owner.kind === 'phase' ? 'tournaments' : 'league_phases');
    },
  );

  it.each([phase, tournament])('rejects incoherent match/round ownership: $kind', async (owner) => {
    const table = owner.kind === 'phase' ? 'phase_rounds' : 'rounds';
    persistence.rows[table][0][owner.kind === 'phase' ? 'phase_id' : 'tournament_id'] = uid(9);
    expect(await check([ref(owner, 'game', uid(5))])).toEqual({ ok: false, reason: 'ownership_unavailable' });
  });

  it('never treats a legacy league-owned tournament as standalone, for any resource', async () => {
    persistence.rows.tournaments[0].season_id = uid(1);
    expect(await createAdminAgentOwnershipReader().resolve(all(tournament))).toEqual([null, null, null, null]);
    expect(persistence.calls.map((call) => call.table)).not.toContain('league_phases');
  });

  it('requires a non-null phase league and a real league row', async () => {
    persistence.rows.league_phases[0].season_id = null;
    expect(await createAdminAgentOwnershipReader().resolve(all(phase))).toEqual([null, null, null, null]);
  });

  it('accepts direct phase-only and league authority, but never legacy tournament assignments for phases', async () => {
    auth.live.mockResolvedValue({ ...player, isAdmin: false, isResourceAdmin: false });
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [], phaseIds: [uid(2)] });
    auth.legacy.mockResolvedValue({ ...legacyScope, isSiteAdmin: false, seasonIds: [], tournamentIds: [] });
    expect(await check(all(phase))).toMatchObject({ ok: true });
    expect(await check(all(tournament))).toMatchObject({ ok: false });
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [uid(1)], phaseIds: [] });
    expect(await check(all(phase))).toMatchObject({ ok: true });
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [], phaseIds: [] });
    auth.legacy.mockResolvedValue({ ...legacyScope, isSiteAdmin: false, seasonIds: [uid(1)], tournamentIds: [uid(2)] });
    expect(await check(all(phase))).toMatchObject({ ok: false });
    expect(await check(all(tournament))).toMatchObject({ ok: true });
  });

  it('reauthorizes every resolve, including role revocation on a reused reader', async () => {
    const reader = createAdminAgentOwnershipReader();
    expect(await reader.resolve(all(phase))).toEqual(all(phase));
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [], phaseIds: [] });
    expect(await reader.resolve(all(phase))).toEqual([null, null, null, null]);
    const revoked = new Error('live role revoked');
    auth.live.mockRejectedValue(revoked);
    persistence.calls = [];
    await expect(reader.resolve(all(phase))).rejects.toBe(revoked);
    expect(persistence.calls).toEqual([]);
    expect(auth.live).toHaveBeenCalledTimes(3);
  });

  it('does not transfer authority across stores with colliding competition and child ids', async () => {
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [], phaseIds: [uid(2)] });
    auth.legacy.mockResolvedValue({ ...legacyScope, isSiteAdmin: false, seasonIds: [], tournamentIds: [] });
    expect(await createAdminAgentOwnershipReader().resolve([...all(tournament), ...all(phase)]))
      .toEqual([null, null, null, null, ...all(phase)]);
    auth.phase.mockResolvedValue({ ...phaseScope, isSiteAdmin: false, seasonIds: [], phaseIds: [] });
    auth.legacy.mockResolvedValue({ ...legacyScope, isSiteAdmin: false, seasonIds: [], tournamentIds: [uid(2)] });
    expect(await createAdminAgentOwnershipReader().resolve([...all(tournament), ...all(phase)]))
      .toEqual([...all(tournament), null, null, null, null]);
  });

  it.each(['phase', 'legacy'] as const)('fails closed on a %s access read error before ownership reads', async (scope) => {
    const error = new Error('scope lookup failed');
    auth[scope].mockRejectedValue(error);
    await expect(check([...all(phase), ...all(tournament)])).rejects.toBe(error);
    expect(persistence.calls).toEqual([]);
  });

  it.each(['seasons', 'league_phases', 'phase_rounds', 'phase_matches', 'phase_games', 'tournaments', 'rounds', 'matches', 'games'])(
    'propagates the original %s failure, never partial authorization', async (table) => {
      persistence.errorTable = table;
      await expect(check([...all(phase), ...all(tournament)])).rejects.toBe(persistence.error);
    },
  );

  it('refuses null data without an error instead of treating the read as an empty store', async () => {
    persistence.nullTable = 'phase_games';
    await expect(check([ref(phase, 'game', uid(5))])).rejects.toThrow('Agent ownership read returned no data');
  });

  it('validates direct adapter and query calls before any authentication or data query', async () => {
    for (const invalid of [[{ resource: 'game', owner: phase, id: 'bad' }], Array.from({ length: 201 }, () => ref(phase, 'competition'))]) {
      await expect(createAdminAgentOwnershipReader().resolve(invalid as AgentResourceRef[])).rejects.toThrow();
      await expect(getAgentOwnershipGraph(invalid as AgentResourceRef[])).rejects.toThrow();
    }
    expect(await createAdminAgentOwnershipReader().resolve([])).toEqual([]);
    await getAgentOwnershipGraph([]);
    expect(auth.live).not.toHaveBeenCalled();
    expect(persistence.calls).toEqual([]);
  });

  it('deduplicates PK batches, preserves result order and duplicates, and selects no private columns', async () => {
    const refs = [ref(phase, 'game', uid(5)), ref(tournament, 'game', uid(5)), ref(phase, 'game', uid(5))];
    expect(await createAdminAgentOwnershipReader().resolve(refs)).toEqual(refs);
    expect(persistence.calls).toHaveLength(9);
    for (const call of persistence.calls) {
      expect(call.ids).toHaveLength(1);
      expect(call.columns.split(',').map((key) => key.trim()).every((key) =>
        ['id', 'match_id', 'phase_id', 'tournament_id', 'round_id', 'season_id'].includes(key))).toBe(true);
    }
  });

  it('batches 200 full game chains in 50-key reads rather than N+1', async () => {
    persistence.rows = { seasons: [{ id: uid(1) }], league_phases: [{ id: uid(2), season_id: uid(1) }] };
    const refs = Array.from({ length: 200 }, (_, i) => {
      const id = uid(100 + i);
      (persistence.rows.phase_games ??= []).push({ id, match_id: uid(400 + i) });
      (persistence.rows.phase_matches ??= []).push({ id: uid(400 + i), phase_id: uid(2), round_id: uid(700 + i) });
      (persistence.rows.phase_rounds ??= []).push({ id: uid(700 + i), phase_id: uid(2) });
      return ref(phase, 'game', id);
    });
    expect(await check(refs)).toMatchObject({ ok: true });
    expect(persistence.calls).toHaveLength(14);
    expect(persistence.calls.every((call) => call.ids.length <= 50)).toBe(true);
    expect(persistence.calls.filter((call) => call.table === 'phase_games').map((call) => call.ids.length)).toEqual([50, 50, 50, 50]);
  });

  it('bounds even 200 incoherent chains with 400 distinct competition and league parents', async () => {
    persistence.rows = {};
    const refs = Array.from({ length: 200 }, (_, i) => {
      const matchPhase = uid(1000 + i);
      const roundPhase = uid(2000 + i);
      (persistence.rows.phase_games ??= []).push({ id: uid(100 + i), match_id: uid(400 + i) });
      (persistence.rows.phase_matches ??= []).push({ id: uid(400 + i), phase_id: matchPhase, round_id: uid(700 + i) });
      (persistence.rows.phase_rounds ??= []).push({ id: uid(700 + i), phase_id: roundPhase });
      (persistence.rows.league_phases ??= []).push(
        { id: matchPhase, season_id: uid(3000 + i) }, { id: roundPhase, season_id: uid(4000 + i) },
      );
      (persistence.rows.seasons ??= []).push({ id: uid(3000 + i) }, { id: uid(4000 + i) });
      return ref(phase, 'game', uid(100 + i));
    });
    expect(await createAdminAgentOwnershipReader().resolve(refs)).toEqual(Array(200).fill(null));
    expect(persistence.calls).toHaveLength(28);
    expect(persistence.calls.every((call) => call.ids.length <= 50)).toBe(true);
  });
});
