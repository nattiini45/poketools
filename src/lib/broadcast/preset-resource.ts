import 'server-only';
import { z } from 'zod';
import { requireCreator } from '@/lib/auth/helpers';
import { getPresetById } from '@/lib/supabase/queries/broadcast-presets';
import { getAgentOwnershipGraph, getAgentResourceOwner } from '@/lib/supabase/queries/agent-ownership';
import { matchResourceRefSchema, resourceRefKey } from '@/lib/ai/agent/resource-ref';
import { OVERLAY_TYPES } from './url-builder';
import type { BroadcastPresetConfig } from '@/types/broadcast';
import type { BroadcastPresetResource } from '@/types/broadcast-resource';

const resourceSchema = z.strictObject({
  version: z.literal(1),
  overlay: z.enum(['match_preview', 'match_live', 'match_results', 'match_story', 'match_teams', 'match_h2h', 'match_moments']),
  target: matchResourceRefSchema,
});

export type BroadcastPresetResourceResult =
  | { kind: 'legacy'; config: BroadcastPresetConfig }
  | { kind: 'resolved'; config: BroadcastPresetConfig; resource: BroadcastPresetResource; url: string }
  | { kind: 'refused'; reason: 'invalid_id' | 'not_found' | 'forbidden' | 'invalid_reference' | 'preset_type_mismatch' | 'ownership_unavailable' | 'ownership_mismatch' };

export function createBroadcastPresetResourceResolver(buildUrl: (input: {
  config: BroadcastPresetConfig; resource: BroadcastPresetResource;
}) => string) {
  return async (id: string): Promise<BroadcastPresetResourceResult> => {
    if (!z.uuid().safeParse(id).success) return { kind: 'refused', reason: 'invalid_id' };
    const actor = await requireCreator();
    const preset = await getPresetById(id);
    if (!preset) return { kind: 'refused', reason: 'not_found' };
    if (preset.owner_id !== actor.playerId && !actor.isAdmin) return { kind: 'refused', reason: 'forbidden' };
    if (preset.config === null || typeof preset.config !== 'object') return { kind: 'refused', reason: 'invalid_reference' };
    if (preset.config.resource === undefined) return { kind: 'legacy', config: preset.config };
    const parsed = resourceSchema.safeParse(preset.config.resource);
    if (!parsed.success) return { kind: 'refused', reason: 'invalid_reference' };
    const resource: BroadcastPresetResource = { ...parsed.data, target: parsed.data.target };
    if (OVERLAY_TYPES[resource.overlay].presetType !== preset.preset_type) return { kind: 'refused', reason: 'preset_type_mismatch' };
    const graph = await getAgentOwnershipGraph([resource.target]);
    const owner = getAgentResourceOwner(resource.target, graph);
    if (!owner) return { kind: 'refused', reason: 'ownership_unavailable' };
    const actual = { ...resource.target, owner };
    if (resourceRefKey(actual) !== resourceRefKey(resource.target)) return { kind: 'refused', reason: 'ownership_mismatch' };
    return { kind: 'resolved', config: preset.config, resource, url: buildUrl({ config: preset.config, resource }) };
  };
}
