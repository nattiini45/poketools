import { beforeEach, expect, it, vi } from 'vitest';
import { phasePageGate } from '../phase-page-gate';

const h = vi.hoisted(() => ({
  mode: vi.fn(), canonical: vi.fn(), native: vi.fn(), legacy: vi.fn(), standalone: vi.fn(),
}));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  resolveLeaguePhaseRoute: h.canonical, findNativePhaseAliasOwner: h.native, findLegacyPhaseAliasOwner: h.legacy,
  standaloneTournamentAliasExists: h.standalone,
}));

const season = '00000000-0000-4000-8000-000000000011';
const phase = '00000000-0000-4000-8000-000000000012';
const match = '00000000-0000-4000-8000-000000000013';
const native = { kind: 'phase', season_id: season, phase_id: phase };
const canonical = `/leagues/${season}/phases/${phase}`;
const noQuery = new URLSearchParams();

beforeEach(() => {
  vi.resetAllMocks();
  h.mode.mockResolvedValue('phase');
  h.native.mockResolvedValue(native);
  h.canonical.mockResolvedValue(native);
});

it.each([
  [`/tournaments/${phase}`, canonical],
  [`/tournaments/${phase}/stats`, `${canonical}/stats`],
  [`/tournaments/${phase}/matches/${match}`, `${canonical}/matches/${match}`],
  [`/matches/${match}`, `${canonical}/matches/${match}`],
  [`/admin/tournaments/${phase}/rounds`, `/admin${canonical}`],
])('resolves %s to its canonical destination with repeated query keys', async (source, href) => {
  expect(await phasePageGate(source, new URLSearchParams('world=sakura&filter=a&filter=b')))
    .toEqual({ kind: 'redirect', href: `${href}?world=sakura&filter=a&filter=b` });
  expect(h.standalone).not.toHaveBeenCalled();
});

it('does not redirect or probe phase ownership for old URLs in legacy mode', async () => {
  h.mode.mockResolvedValue('legacy');
  expect(await phasePageGate(`/tournaments/${phase}`, noQuery)).toEqual({ kind: 'pass' });
  expect(h.native).not.toHaveBeenCalled();
  expect(h.legacy).not.toHaveBeenCalled();
});

it.each(['frozen_legacy', 'frozen_phase'])('returns unavailable for a verified alias during %s', async mode => {
  h.mode.mockResolvedValue(mode);
  h.legacy.mockResolvedValue(mode === 'frozen_legacy' ? { season_id: season } : null);
  expect(await phasePageGate(`/tournaments/${phase}`, noQuery)).toEqual({ kind: 'unavailable' });
  expect(mode === 'frozen_phase' ? h.native : h.legacy).toHaveBeenCalledExactlyOnceWith({ phaseId: phase });
  expect(await phasePageGate(canonical, noQuery)).toEqual({ kind: 'unavailable' });
  expect(h.canonical).not.toHaveBeenCalled();
});

it('blocks a stale legacy phase alias when the native transfer is frozen and no native owner was moved', async () => {
  h.mode.mockResolvedValue('frozen_phase');
  h.native.mockResolvedValue(null);
  h.legacy.mockResolvedValue({ season_id: season });
  expect(await phasePageGate(`/tournaments/${phase}`, noQuery)).toEqual({ kind: 'unavailable' });
  expect(h.legacy).toHaveBeenCalledExactlyOnceWith({ phaseId: phase });
  expect(h.standalone).not.toHaveBeenCalled();
});

it('passes only verified standalone aliases while frozen', async () => {
  h.mode.mockResolvedValue('frozen_phase');
  h.native.mockResolvedValue(null);
  h.legacy.mockResolvedValue(null);
  h.standalone.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await phasePageGate(`/tournaments/${phase}`, noQuery)).toEqual({ kind: 'pass' });
  expect(await phasePageGate(`/tournaments/${phase}`, noQuery)).toEqual({ kind: 'not_found' });
});

it('returns not found for wrong-league matches, rather than probing another store', async () => {
  h.native.mockResolvedValue({ ...native, season_id: match });
  expect(await phasePageGate(`${canonical}/matches/${match}`, noQuery)).toEqual({ kind: 'not_found' });
  expect(h.native).toHaveBeenCalledExactlyOnceWith({ phaseId: phase, matchId: match });
  expect(h.legacy).not.toHaveBeenCalled();
});

it('only passes a native-mode alias miss that names a verified standalone tournament resource', async () => {
  h.native.mockResolvedValue(null);
  h.standalone.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const path = `/tournaments/${phase}/matches/${match}`;
  expect(await phasePageGate(path, noQuery)).toEqual({ kind: 'pass' });
  expect(await phasePageGate(path, noQuery)).toEqual({ kind: 'not_found' });
  expect(h.standalone).toHaveBeenCalledWith({ phaseId: phase, matchId: match });
});

it('reports a lookup failure as unavailable rather than a cacheable missing public page', async () => {
  h.mode.mockRejectedValue(new Error('Lookup failed'));
  expect(await phasePageGate(canonical, noQuery)).toEqual({ kind: 'unavailable' });
  expect(h.canonical).not.toHaveBeenCalled();
});

it('does not read readiness for unrelated pages or malformed IDs', async () => {
  expect(await phasePageGate('/leagues', noQuery)).toEqual({ kind: 'pass' });
  expect(await phasePageGate(`${canonical}/matches/%2F`, noQuery)).toEqual({ kind: 'not_found' });
  expect(h.mode).not.toHaveBeenCalled();
});
