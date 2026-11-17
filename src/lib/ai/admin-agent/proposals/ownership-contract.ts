import { z } from 'zod';
import { contentHash } from '@/lib/studio-core/json';
import { agentResourceRefSchema, validateAgentResourceRefs, type AgentOwnershipReader } from '../../agent/resource-ref';
import { planDocumentSchema, type PlanDocument } from '../plans/schema';

export type AgentStorageGeneration = 'legacy' | 'native-phase-v1';

export function ownershipRegistryVersion(version: string, generation: AgentStorageGeneration): string {
  return generation === 'legacy' ? version : contentHash({ registry: version, ownership: generation });
}

export const nativePlanReferencesSchema = z.strictObject({
  v: z.literal(1),
  generation: z.literal('native-phase-v1'),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
  refs: z.record(z.string(), agentResourceRefSchema),
}).refine((value) => Object.keys(value.refs).length <= 200, { message: 'too_many_refs' });
export type NativePlanReferences = z.output<typeof nativePlanReferencesSchema>;

export type NativePlanCheck =
  | { ok: true; plan: PlanDocument; references: NativePlanReferences }
  | { ok: false; reason: 'invalid_plan' | 'reconfirmation_required' | 'document_changed' | 'reference_mismatch' | 'ownership_unavailable' | 'ownership_mismatch' | 'invalid_refs' };

export async function validateNativePlanReferences(
  document: unknown,
  references: unknown,
  reader: AgentOwnershipReader,
): Promise<NativePlanCheck> {
  const parsed = planDocumentSchema.safeParse(document);
  if (!parsed.success) return { ok: false, reason: 'invalid_plan' };
  const contract = nativePlanReferencesSchema.safeParse(references);
  if (!contract.success) return { ok: false, reason: 'reconfirmation_required' };
  if (contentHash(document) !== contract.data.documentHash) return { ok: false, reason: 'document_changed' };
  const plan = parsed.data;
  const explicit = contract.data.refs;
  const keys = Object.keys(explicit);
  const ownedKeys = Object.keys(plan.refs).filter((key) => key === 'tournament' || key.startsWith('phase.'));
  if (keys.length !== ownedKeys.length || keys.some((key) => !ownedKeys.includes(key))) {
    return { ok: false, reason: 'reference_mismatch' };
  }
  for (const key of ownedKeys) {
    const stored = plan.refs[key];
    const ref = explicit[key];
    if (!ref || ref.resource !== 'competition') return { ok: false, reason: 'reference_mismatch' };
    if (key.startsWith('phase.')) {
      if (stored.entity_type !== 'phase' || ref.owner.kind !== 'phase' || ref.owner.phaseId !== stored.entity_id.toLowerCase()
        || plan.refs.league?.entity_type !== 'season' || ref.owner.seasonId !== plan.refs.league.entity_id.toLowerCase()) {
        return { ok: false, reason: 'reference_mismatch' };
      }
    } else if (stored.entity_type !== 'tournament' || ref.owner.kind !== 'tournament' || ref.owner.tournamentId !== stored.entity_id.toLowerCase()) {
      return { ok: false, reason: 'reference_mismatch' };
    }
  }
  const verified = await validateAgentResourceRefs(Object.values(explicit), reader);
  if (!verified.ok) return verified;
  return { ok: true, plan, references: contract.data };
}
