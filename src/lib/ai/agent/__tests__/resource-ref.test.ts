import { describe, expect, it, vi } from 'vitest';
import { agentResourceRefSchema, resourceRefKey, validateAgentResourceRefs, type AgentResourceRef } from '../resource-ref';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const phase = { kind: 'phase' as const, seasonId: id(1), phaseId: id(2) };
const match: AgentResourceRef = { resource: 'match', owner: phase, id: id(3) };

describe('explicit agent ownership references', () => {
  it('accepts native refs without a tournament identity and keeps colliding ids distinct', () => {
    expect(agentResourceRefSchema.parse(match)).toEqual(match);
    const standalone: AgentResourceRef = { resource: 'match', owner: { kind: 'tournament', tournamentId: id(2) }, id: id(3) };
    expect(resourceRefKey(match)).not.toBe(resourceRefKey(standalone));
  });

  it.each([
    { ...match, tournament_id: id(2) },
    { ...match, owner: { ...phase, tournamentId: id(2) } },
    { ...match, owner: { kind: 'phase', phaseId: id(2) } },
    { ...match, id: 'untrusted' },
  ])('rejects ambiguous or malformed shapes', (ref) => {
    expect(agentResourceRefSchema.safeParse(ref).success).toBe(false);
  });

  it('validates the batch before any read and never truncates it', async () => {
    const resolve = vi.fn();
    expect(await validateAgentResourceRefs(Array(201).fill(match), { resolve })).toEqual({ ok: false, reason: 'invalid_refs' });
    expect(resolve).not.toHaveBeenCalled();
    expect(await validateAgentResourceRefs([], { resolve })).toEqual({ ok: true, refs: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('checks every child and its league against the authoritative batch result', async () => {
    const refs: AgentResourceRef[] = [match, { resource: 'round', owner: phase, id: id(4) }, { resource: 'game', owner: phase, id: id(5) }];
    const resolve = vi.fn(async () => refs);
    expect(await validateAgentResourceRefs(refs, { resolve })).toEqual({ ok: true, refs });
    expect(resolve).toHaveBeenCalledTimes(1);
    for (const owner of [{ ...phase, seasonId: id(8) }, { ...phase, phaseId: id(8) }, { kind: 'tournament' as const, tournamentId: id(2) }]) {
      expect(await validateAgentResourceRefs([match], { resolve: async () => [{ ...match, owner }] })).toEqual({ ok: false, reason: 'ownership_mismatch' });
    }
  });

  it('fails closed on missing, incomplete or failed reads', async () => {
    for (const refs of [[], [null]]) {
      expect(await validateAgentResourceRefs([match], { resolve: async () => refs })).toEqual({ ok: false, reason: 'ownership_unavailable' });
    }
    const error = new Error('reader unavailable');
    await expect(validateAgentResourceRefs([match], { resolve: async () => { throw error; } })).rejects.toBe(error);
  });
});
