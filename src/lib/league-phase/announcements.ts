import 'server-only';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import { emitPhaseSocialEvent } from '@/lib/social/notify';
import { buildFinalizationNotifications } from '@/lib/match/finalization-notifications';
import type { PhaseFinalizationEffects } from './finalization';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';
import type { NativeMatchDecisionEffects } from './match-decisions';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { logAuditEvent } from '@/lib/audit/log';
import type { NativeKitMatchCallbacks } from './kit-match-effects';

export const announcePhaseMatchCompletion: PhaseFinalizationEffects['announcements'] = input => {
  const { match, competition: phase } = input;
  if (match.phase_id !== phase.id) throw new Error('Native announcement phase scope mismatch');
  const owner = { kind: 'phase' as const, phase_id: phase.id, season_id: phase.season_id };
  for (const event of buildFinalizationNotifications(input)) {
    let payload: PhaseDiscordEventPayload;
    switch (event.event_type) {
      case 'match_confirmed':
        payload = { version: 1, owner, event_type: event.event_type, data: { ...event.data, phase_name: phase.name } };
        break;
      case 'achievement_unlocked':
        payload = { version: 1, owner, event_type: event.event_type, data: { ...event.data, phase_name: phase.name } };
        break;
      case 'streak_milestone':
        payload = { version: 1, owner, event_type: event.event_type, data: { ...event.data, phase_name: phase.name } };
        break;
      case 'streak_broken':
        payload = { version: 1, owner, event_type: event.event_type, data: { ...event.data, phase_name: phase.name } };
        break;
      case 'rating_milestone':
        payload = { version: 1, owner, event_type: event.event_type, data: { ...event.data, phase_name: phase.name } };
        break;
    }
    emitPhaseDiscordEvent(payload);
    emitPhaseSocialEvent({ ...payload, ...('imageUrl' in event ? { imageUrl: event.imageUrl } : {}) });
  }
};

export const announcePhaseMatchDispute: NativeMatchDecisionEffects['announceDispute'] = async ({ match, player }) => {
  const phase = await getPhaseById(match.phase_id);
  if (!phase) throw new Error('Native dispute announcement phase not found');
  const payload: PhaseDiscordEventPayload = {
    version: 1, owner: { kind: 'phase', phase_id: phase.id, season_id: phase.season_id }, event_type: 'match_disputed',
    data: { kind: 'match_disputed', player_1_name: match.player_1_name, player_2_name: match.player_2_name,
      disputer_name: player.name, phase_name: phase.name },
  };
  emitPhaseDiscordEvent(payload);
  emitPhaseSocialEvent(payload);
};

export const announceNativeKitStageCompletion: NativeKitMatchCallbacks['stageCompleted'] = async ({ phase, reason, retry, reaction }) => {
  logAuditEvent({
    action: 'phase.update', actor_id: null, actor_name: 'System', resource_type: 'phase',
    resource_id: phase.id, resource_name: phase.name,
    ...(retry ? {} : { changes: { status: { before: 'active', after: 'completed' } } }),
    metadata: { via: retry ? 'stage_end_retry' : 'stage_end', reason,
      auto_advanced: reaction.advance.results.length, auto_advance_error: reaction.advance.error,
      ...(!retry ? { auto_advance_held: reaction.held } : {}),
    },
  });
  if (retry) return;
  const payload: PhaseDiscordEventPayload = {
    version: 1, owner: { kind: 'phase', phase_id: phase.id, season_id: phase.season_id }, event_type: 'phase_completed',
    data: { kind: 'phase_status', phase_name: phase.name, new_status: 'completed' },
  };
  emitPhaseDiscordEvent(payload);
  emitPhaseSocialEvent(payload);
};
