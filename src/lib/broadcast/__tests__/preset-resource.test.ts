import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentOwnershipGraph } from '@/lib/supabase/queries/agent-ownership';

const h = vi.hoisted(() => ({ actor: vi.fn(), preset: vi.fn(), graph: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/auth/helpers', () => ({ requireCreator: h.actor }));
vi.mock('@/lib/supabase/queries/broadcast-presets', () => ({ getPresetById: h.preset }));
vi.mock('@/lib/supabase/queries/agent-ownership', async original => ({
  ...await original<typeof import('@/lib/supabase/queries/agent-ownership')>(), getAgentOwnershipGraph: h.graph,
}));
import { createBroadcastPresetResourceResolver } from '../preset-resource';

const phaseId = '20000000-0000-4000-8000-000000000001';
const seasonId = '20000000-0000-4000-8000-000000000002';
const matchId = '20000000-0000-4000-8000-000000000003';
const roundId = '20000000-0000-4000-8000-000000000004';
const presetId = '20000000-0000-4000-8000-000000000005';
const otherId = '20000000-0000-4000-8000-000000000006';
const target = { resource: 'match', id: matchId, owner: { kind: 'phase', phaseId, seasonId } } as const;
const resource = { version: 1, overlay: 'match_preview', target } as const;
const buildUrl = vi.fn(() => 'https://example.invalid/canonical-resource');
const resolve = createBroadcastPresetResourceResolver(buildUrl);

function graph(): AgentOwnershipGraph {
  return {
    phase: { games: new Map(), matches: new Map([[matchId, { id: matchId, parentId: phaseId, roundId }]]),
      rounds: new Map([[roundId, { id: roundId, parentId: phaseId }]]),
      competitions: new Map([[phaseId, { id: phaseId, seasonId }]]) },
    tournament: { games: new Map(), matches: new Map(), rounds: new Map(), competitions: new Map() },
    seasons: new Set([seasonId]),
  };
}

function preset(config: object = { theme: 'light', resource, extra: { opaque: ['untouched'] } }) {
  return { id: presetId, owner_id: 'creator', name: 'Synthetic preset', preset_type: 'match_preview', config,
    created_at: '', updated_at: '' };
}

beforeEach(() => {
  vi.resetAllMocks(); buildUrl.mockReturnValue('https://example.invalid/canonical-resource');
  h.actor.mockResolvedValue({ playerId: 'creator', isAdmin: false, isCreator: true });
  h.preset.mockResolvedValue(preset()); h.graph.mockResolvedValue(graph());
});

describe('versioned broadcast preset resource resolver', () => {
  it('resolves native parents live and gives only an explicit verified resource to the canonical URL binding', async () => {
    const config = Object.freeze({ theme: 'light', resource, extra: Object.freeze({ phase_id: 'not-an-authority', opaque: ['untouched'] }) });
    h.preset.mockResolvedValue(preset(config));
    const result = await resolve(presetId);
    expect(result).toEqual({ kind: 'resolved', config, resource, url: 'https://example.invalid/canonical-resource' });
    expect(h.actor).toHaveBeenCalledOnce(); expect(h.graph).toHaveBeenCalledExactlyOnceWith([target]);
    expect(buildUrl).toHaveBeenCalledExactlyOnceWith({ config, resource });
    if (result.kind === 'resolved') expect(result.config).toBe(config);
  });

  it('keeps unversioned preset/config bytes and unknown extras on the old path without guessing ownership', async () => {
    const config = Object.freeze({ extra: { phase_id: phaseId, tournament_id: phaseId, match_id: matchId }, poll: 5000 });
    h.preset.mockResolvedValue(preset(config));
    expect(await resolve(presetId)).toEqual({ kind: 'legacy', config });
    expect(h.graph).not.toHaveBeenCalled(); expect(buildUrl).not.toHaveBeenCalled();
  });

  it.each([
    { ...resource, version: 2 },
    { ...resource, target: { ...target, resource: 'round' } },
    { ...resource, target: { ...target, owner: { ...target.owner, tournamentId: phaseId } } },
    { ...resource, overlay: 'standings' },
  ])('refuses malformed or unsupported new contracts without a legacy fallback', async invalid => {
    h.preset.mockResolvedValue(preset({ resource: invalid }));
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'invalid_reference' });
    expect(h.graph).not.toHaveBeenCalled(); expect(buildUrl).not.toHaveBeenCalled();
  });

  it('checks preset ownership and live creator authority before reading resource metadata', async () => {
    h.preset.mockResolvedValue({ ...preset(), owner_id: 'another-owner' });
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'forbidden' });
    expect(h.graph).not.toHaveBeenCalled();
    h.actor.mockRejectedValue(new Error('Creator access revoked')); h.preset.mockClear();
    await expect(resolve(presetId)).rejects.toThrow('Creator access revoked');
    expect(h.preset).not.toHaveBeenCalled();
  });

  it('rejects an overlay/preset family mismatch before resolving metadata', async () => {
    h.preset.mockResolvedValue({ ...preset(), preset_type: 'match_results' });
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'preset_type_mismatch' });
    expect(h.graph).not.toHaveBeenCalled();
  });

  it('does not trust a well-formed reference with the wrong actual league', async () => {
    const actual = graph(); actual.phase.competitions.set(phaseId, { id: phaseId, seasonId: otherId }); actual.seasons.add(otherId);
    h.graph.mockResolvedValue(actual);
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'ownership_mismatch' });
    expect(buildUrl).not.toHaveBeenCalled();
  });

  it('requires the actual round chain and never tries a colliding standalone row as a native fallback', async () => {
    const actual = graph(); actual.phase.rounds.clear();
    actual.tournament.matches.set(matchId, { id: matchId, parentId: phaseId, roundId });
    actual.tournament.rounds.set(roundId, { id: roundId, parentId: phaseId });
    actual.tournament.competitions.set(phaseId, { id: phaseId, seasonId: null });
    h.graph.mockResolvedValue(actual);
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'ownership_unavailable' });
    expect(buildUrl).not.toHaveBeenCalled();
  });

  it('supports explicit standalone refs but refuses a legacy phase tournament', async () => {
    const standalone = { ...target, owner: { kind: 'tournament', tournamentId: phaseId } } as const;
    h.preset.mockResolvedValue(preset({ resource: { ...resource, target: standalone } }));
    const actual = graph();
    actual.tournament.matches.set(matchId, { id: matchId, parentId: phaseId, roundId });
    actual.tournament.rounds.set(roundId, { id: roundId, parentId: phaseId });
    actual.tournament.competitions.set(phaseId, { id: phaseId, seasonId: null });
    h.graph.mockResolvedValue(actual);
    expect((await resolve(presetId)).kind).toBe('resolved');
    actual.tournament.competitions.set(phaseId, { id: phaseId, seasonId });
    expect(await resolve(presetId)).toEqual({ kind: 'refused', reason: 'ownership_unavailable' });
  });

  it('propagates owner/read/builder failures instead of returning a successful stale URL', async () => {
    const error = new Error('Actual ownership unavailable'); h.graph.mockRejectedValueOnce(error);
    await expect(resolve(presetId)).rejects.toBe(error);
    buildUrl.mockImplementationOnce(() => { throw error; });
    await expect(resolve(presetId)).rejects.toBe(error);
  });

  it('reads nothing for malformed ids or when constructing the dormant resolver', async () => {
    createBroadcastPresetResourceResolver(buildUrl);
    expect(await resolve('not-a-uuid')).toEqual({ kind: 'refused', reason: 'invalid_id' });
    expect(h.actor).not.toHaveBeenCalled(); expect(h.preset).not.toHaveBeenCalled(); expect(h.graph).not.toHaveBeenCalled();
  });
});
