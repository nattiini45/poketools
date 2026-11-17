import type { AgentResourceRef } from '@/lib/ai/agent/resource-ref';

export type BroadcastMatchOverlay = 'match_preview' | 'match_live' | 'match_results' | 'match_story'
  | 'match_teams' | 'match_h2h' | 'match_moments';

export interface BroadcastPresetResource {
  version: 1;
  overlay: BroadcastMatchOverlay;
  target: Extract<AgentResourceRef, { resource: 'match' }>;
}
