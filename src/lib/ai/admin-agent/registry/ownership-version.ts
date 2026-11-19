import { contentHash } from '@/lib/studio-core/json';
import type { getPhaseRouteMode } from '@/lib/league-phase/route-mode';

export type AgentStorageGeneration = 'legacy' | 'native-phase-v1';
export type ProposalStorageMode = Awaited<ReturnType<typeof getPhaseRouteMode>> | null;

export function ownershipRegistryVersion(version: string, generation: AgentStorageGeneration): string {
  return generation === 'legacy' ? version : contentHash({ registry: version, ownership: generation });
}

export function proposalStorageGeneration(mode: ProposalStorageMode): AgentStorageGeneration {
  return mode === 'phase' || mode === 'frozen_phase' ? 'native-phase-v1' : 'legacy';
}
