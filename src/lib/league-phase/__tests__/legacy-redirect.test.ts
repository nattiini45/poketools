import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPhaseRouteMode } from '../route-mode';
import { findNativePhaseAliasOwner } from '@/lib/supabase/queries/phase-route-owners';
import { resolveLegacyPhaseRedirect } from '../legacy-redirect';

vi.mock('../route-mode', () => ({ getPhaseRouteMode: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ findNativePhaseAliasOwner: vi.fn() }));

const league = '00000000-0000-4000-8000-000000000021';
const phase = '00000000-0000-4000-8000-000000000022';
const match = '00000000-0000-4000-8000-000000000023';
const canonical = `/leagues/${league}/phases/${phase}`;
const query = new URLSearchParams();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPhaseRouteMode).mockResolvedValue('phase');
  vi.mocked(findNativePhaseAliasOwner).mockResolvedValue({ kind: 'phase', season_id: league, phase_id: phase });
});

describe('legacy phase link resolution', () => {
  it.each([
    [`/tournaments/${phase}`, canonical, { phaseId: phase }],
    [`/tournaments/${phase}/stats`, `${canonical}/stats`, { phaseId: phase }],
    [`/tournaments/${phase}/matches/${match}`, `${canonical}/matches/${match}`, { phaseId: phase, matchId: match }],
    [`/matches/${match}/`, `${canonical}/matches/${match}`, { matchId: match }],
    [`/admin/tournaments/${phase}/rounds`, `/admin${canonical}`, { phaseId: phase }],
  ])('resolves %s to its verified same-site canonical URL', async (path, target, lookup) => {
    expect(await resolveLegacyPhaseRedirect(path, query)).toBe(target);
    expect(findNativePhaseAliasOwner).toHaveBeenCalledExactlyOnceWith(lookup);
  });

  it('preserves all query values without letting them choose the redirect target', async () => {
    const options = new URLSearchParams([['tab', 'standings'], ['filter', 'a b'], ['filter', 'two'], ['next', '//example.invalid']]);
    expect(await resolveLegacyPhaseRedirect(`/tournaments/${phase}`, options)).toBe(
      `${canonical}?tab=standings&filter=a+b&filter=two&next=%2F%2Fexample.invalid`,
    );
  });

  it('normalizes UUID case in an alias and in the canonical match target', async () => {
    const upperPhase = '00000000-0000-4000-8000-0000000000AA';
    const upperMatch = '00000000-0000-4000-8000-0000000000BB';
    expect(await resolveLegacyPhaseRedirect(`/tournaments/${upperPhase}/matches/${upperMatch}`, query))
      .toBe(`${canonical}/matches/${upperMatch.toLowerCase()}`);
    expect(findNativePhaseAliasOwner).toHaveBeenCalledExactlyOnceWith({
      phaseId: upperPhase.toLowerCase(), matchId: upperMatch.toLowerCase(),
    });
  });

  it.each(['legacy', 'frozen_legacy', 'frozen_phase'] as const)('does not resolve a permanent target in %s mode', async (mode) => {
    vi.mocked(getPhaseRouteMode).mockResolvedValue(mode);
    expect(await resolveLegacyPhaseRedirect(`/tournaments/${phase}`, query)).toBeNull();
    expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
  });

  it.each([canonical, '/tournaments', '/tournaments/bad/stats', '/matches/%ZZ', `/tournaments/${phase}/matches/%2F`])(
    'does not probe readiness or ownership for %s', async (path) => {
      expect(await resolveLegacyPhaseRedirect(path, query)).toBeNull();
      expect(getPhaseRouteMode).not.toHaveBeenCalled();
      expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
    },
  );

  it('leaves non-phase tournaments and mismatched match aliases alone', async () => {
    vi.mocked(findNativePhaseAliasOwner).mockResolvedValue(null);
    expect(await resolveLegacyPhaseRedirect(`/tournaments/${phase}`, query)).toBeNull();
    expect(await resolveLegacyPhaseRedirect(`/tournaments/${phase}/matches/${match}`, query)).toBeNull();
  });
});
