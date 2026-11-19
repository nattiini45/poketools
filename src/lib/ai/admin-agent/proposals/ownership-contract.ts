import { z } from 'zod';
import { contentHash } from '@/lib/studio-core/json';
import type { ProposalStorageMode } from '../registry/ownership-version';
import { agentResourceRefSchema, validateAgentResourceRefs, type AgentOwnershipReader, type AgentResourceRef } from '../../agent/resource-ref';
import { isRefObject } from '../plans/route-bodies';
import { planDocumentSchema, type PlanDocument } from '../plans/schema';
import type { StepDraft } from './steps';

export interface ProposalOwnershipFence {
  readonly mode: () => Promise<ProposalStorageMode>;
  readonly reader: AgentOwnershipReader;
}

export const isProposalStorageFrozen = (mode: ProposalStorageMode): boolean => mode === 'frozen_legacy' || mode === 'frozen_phase';

/** Outside open legacy storage, only the explicitly supported, phase-independent bindings may run. */
export async function allowsProposalSteps(mode: ProposalStorageMode, steps: readonly StepDraft[], reader: AgentOwnershipReader): Promise<boolean> {
  if (mode === null || mode === 'legacy') return true;
  const refs = new Map<string, AgentResourceRef>();
  const addStandalone = (id: unknown): boolean => {
    if (typeof id !== 'string') return false;
    refs.set(id.toLowerCase(), { resource: 'competition', owner: { kind: 'tournament', tournamentId: id } });
    return true;
  };
  let createsStandalone = false;
  for (const step of steps) {
    switch (step.op) {
      case 'publish_ruleset':
      case 'ruleset_restore_draft':
      case 'ruleset_delete_draft':
        break;
      case 'tournament_create':
        createsStandalone ||= step.key === 'tournament';
        break;
      case 'tournament_participant_add': {
        const id = step.path_params.id;
        if (isRefObject(id) && id.$ref === 'tournament.id' && createsStandalone && step.blocked_by.includes('tournament')) break;
        if (!addStandalone(id)) return false;
        break;
      }
      case 'tournament_participant_remove':
      case 'tournament_archive':
      case 'generate_bracket':
      case 'start_phase':
        if (!addStandalone(step.path_params[step.op === 'start_phase' ? 'tid' : 'id'])) return false;
        break;
      case 'move_pin': {
        const targets = z.object({ targets: z.array(z.object({ kind: z.literal('tournament'), id: z.uuid() })).min(1) }).safeParse(step.body_template);
        if (!targets.success) return false;
        for (const target of targets.data.targets) addStandalone(target.id);
        break;
      }
      default:
        return false;
    }
  }
  return (await validateAgentResourceRefs([...refs.values()], reader)).ok;
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
