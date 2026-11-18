import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findNativePhaseAliasOwner, resolveLeaguePhaseRoute } from '../phase-route-owners';

const db = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ eq: secondEq, maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, secondEq, maybeSingle };
});

describe('native alias owner queries', () => {
  it('looks up the league from the phase row and selects no other fields', async () => {
    expect(await findNativePhaseAliasOwner({ phaseId })).toEqual({ kind: 'phase', phase_id: phaseId, season_id: seasonId });
    expect(db.from).toHaveBeenCalledExactlyOnceWith('league_phases');
    expect(db.select).toHaveBeenCalledExactlyOnceWith('id, season_id');
  });

  it('requires the match to belong to the phase named in a nested alias', async () => {
    const matchId = '00000000-0000-4000-8000-000000000013';
    db.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await findNativePhaseAliasOwner({ phaseId, matchId })).toBeNull();
    expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_matches');
    expect(db.eq).toHaveBeenCalledExactlyOnceWith('id', matchId);
    expect(db.secondEq).toHaveBeenCalledExactlyOnceWith('phase_id', phaseId);
  });

  it('reads only the match ownership chain for a match-only alias', async () => {
    db.maybeSingle.mockResolvedValue({ data: { phase_id: phaseId, phase: { season_id: seasonId } }, error: null });
    expect(await findNativePhaseAliasOwner({ matchId: phaseId })).toEqual({ kind: 'phase', phase_id: phaseId, season_id: seasonId });
    expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_matches');
    expect(db.select).toHaveBeenCalledExactlyOnceWith('phase_id, phase:league_phases!phase_matches_phase_id_fkey!inner(season_id)');
    expect(db.secondEq).not.toHaveBeenCalled();
  });
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));

const seasonId = '00000000-0000-4000-8000-000000000011';
const phaseId = '00000000-0000-4000-8000-000000000012';

beforeEach(() => {
  vi.clearAllMocks();
  db.maybeSingle.mockResolvedValue({ data: { id: phaseId, season_id: seasonId }, error: null });
});

describe('canonical league phase ownership', () => {
  it.each([
    ['legacy', 'tournaments', { kind: 'tournament', tournament_id: phaseId, season_id: seasonId }],
    ['phase', 'league_phases', { kind: 'phase', phase_id: phaseId, season_id: seasonId }],
  ] as const)('queries only the %s store with both ownership filters', async (mode, table, owner) => {
    expect(await resolveLeaguePhaseRoute(seasonId, phaseId, mode)).toEqual(owner);
    expect(db.from).toHaveBeenCalledExactlyOnceWith(table);
    expect(db.select).toHaveBeenCalledExactlyOnceWith('id, season_id');
    expect(db.eq).toHaveBeenCalledExactlyOnceWith('id', phaseId);
    expect(db.secondEq).toHaveBeenCalledExactlyOnceWith('season_id', seasonId);
  });

  it('never uses a legacy collision as a fallback for a native miss', async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolveLeaguePhaseRoute(seasonId, phaseId, 'phase')).toBeNull();
    expect(db.from).toHaveBeenCalledExactlyOnceWith('league_phases');
  });

  it('does not treat a standalone tournament as a league phase', async () => {
    db.maybeSingle.mockResolvedValue({ data: { id: phaseId, season_id: null }, error: null });
    expect(await resolveLeaguePhaseRoute(seasonId, phaseId, 'legacy')).toBeNull();
  });

  it('does not probe either store for malformed IDs or frozen modes', async () => {
    expect(await resolveLeaguePhaseRoute(seasonId, 'bad', 'phase')).toBeNull();
    expect(await resolveLeaguePhaseRoute('bad', phaseId, 'legacy')).toBeNull();
    expect(await resolveLeaguePhaseRoute(seasonId, phaseId, 'frozen_legacy')).toBeNull();
    expect(await resolveLeaguePhaseRoute(seasonId, phaseId, 'frozen_phase')).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('propagates a read failure rather than treating it as a miss', async () => {
    const error = { code: '57014', message: 'Query timed out' };
    db.maybeSingle.mockResolvedValue({ data: null, error });
    await expect(resolveLeaguePhaseRoute(seasonId, phaseId, 'phase')).rejects.toBe(error);
  });
});
