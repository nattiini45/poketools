import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '@/lib/studio-core/json';
import { ownershipRegistryVersion, validateNativePlanReferences } from '../ownership-contract';
import { workedExample, uid } from '../../plans/__tests__/fixtures';

const owner = { kind: 'phase' as const, seasonId: uid(1), phaseId: uid(2) };
const ref = { resource: 'competition' as const, owner };
const nativePlan = () => ({ ...workedExample(), refs: { league: { entity_type: 'season', entity_id: uid(1) }, 'phase.regular_season': { entity_type: 'phase', entity_id: uid(2) } } });
const contract = (plan: unknown) => ({ v: 1, generation: 'native-phase-v1', documentHash: contentHash(plan), refs: { 'phase.regular_season': ref } });

describe('dormant native plan boundary', () => {
  it('preserves legacy versions exactly and separates native approvals', () => {
    expect(ownershipRegistryVersion('registry-v1', 'legacy')).toBe('registry-v1');
    expect(ownershipRegistryVersion('registry-v1', 'native-phase-v1')).not.toBe('registry-v1');
    expect(ownershipRegistryVersion('registry-v1', 'native-phase-v1')).not.toBe(ownershipRegistryVersion('registry-v2', 'native-phase-v1'));
  });

  it('requires a new contract, never edits or upgrades historic JSON', async () => {
    const plan = workedExample();
    plan.refs['phase.regular_season'] = { entity_type: 'tournament', entity_id: uid(2) };
    const original = JSON.stringify(plan);
    const resolve = vi.fn();
    expect(await validateNativePlanReferences(plan, undefined, { resolve })).toEqual({ ok: false, reason: 'reconfirmation_required' });
    expect(await validateNativePlanReferences(plan, contract(plan), { resolve })).toEqual({ ok: false, reason: 'reference_mismatch' });
    expect(JSON.stringify(plan)).toBe(original);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('binds the exact document and validates native owners', async () => {
    const plan = nativePlan();
    const envelope = contract(plan);
    expect(await validateNativePlanReferences(plan, envelope, { resolve: async (refs) => refs })).toMatchObject({ ok: true, plan, references: envelope });
    expect(await validateNativePlanReferences({ ...plan, title: 'Changed' }, envelope, { resolve: vi.fn() })).toEqual({ ok: false, reason: 'document_changed' });
    expect(await validateNativePlanReferences(plan, envelope, { resolve: async () => [null] })).toEqual({ ok: false, reason: 'ownership_unavailable' });
  });

  it('rejects missing, extra, wrong-league and wrong-store bindings before reading', async () => {
    const plan = nativePlan();
    const resolve = vi.fn();
    for (const refs of [{}, { other: ref }, { 'phase.regular_season': { ...ref, owner: { ...owner, seasonId: uid(9) } } }, { 'phase.regular_season': { resource: 'competition', owner: { kind: 'tournament', tournamentId: uid(2) } } }]) {
      expect(await validateNativePlanReferences(plan, { ...contract(plan), refs }, { resolve })).toEqual({ ok: false, reason: 'reference_mismatch' });
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('retains standalone tournament identity and checks its storage independently', async () => {
    const plan = { ...workedExample(), refs: { tournament: { entity_type: 'tournament', entity_id: uid(2) } } };
    const envelope = { ...contract(plan), refs: { tournament: { resource: 'competition', owner: { kind: 'tournament', tournamentId: uid(2) } } } };
    expect(await validateNativePlanReferences(plan, envelope, { resolve: async (refs) => refs })).toMatchObject({ ok: true });
  });
});
