import type { DiscordEventData } from './discord';

type PhaseData<T> = T extends { tournament_name: string }
  ? Omit<T, 'tournament_name' | 'tournament_url'> & { phase_name: string }
    & (T extends { tournament_url: string } ? { phase_url: string } : object)
  : never;

export type PhaseNotificationData = PhaseData<Exclude<DiscordEventData, { kind: 'tournament_status' }>>
  | { kind: 'phase_status'; phase_name: string; new_status: 'active' | 'completed' };

export type PhaseNotificationEventMap = {
  match_result_submitted: Extract<PhaseNotificationData, { kind: 'match_result' }>;
  match_confirmed: Extract<PhaseNotificationData, { kind: 'match_confirmed' }>;
  match_disputed: Extract<PhaseNotificationData, { kind: 'match_disputed' }>;
  round_generated: Extract<PhaseNotificationData, { kind: 'round_generated' }>;
  phase_started: Extract<PhaseNotificationData, { kind: 'phase_status' }> & { new_status: 'active' };
  phase_completed: Extract<PhaseNotificationData, { kind: 'phase_status' }> & { new_status: 'completed' };
  achievement_unlocked: Extract<PhaseNotificationData, { kind: 'achievement_unlocked' }>;
  streak_milestone: Extract<PhaseNotificationData, { kind: 'streak_milestone' }>;
  streak_broken: Extract<PhaseNotificationData, { kind: 'streak_broken' }>;
  rating_milestone: Extract<PhaseNotificationData, { kind: 'rating_milestone' }>;
  round_completed: Extract<PhaseNotificationData, { kind: 'round_completed' }>;
  round_recap_published: Extract<PhaseNotificationData, { kind: 'round_recap_published' }>;
  round_forecast_published: Extract<PhaseNotificationData, { kind: 'round_forecast_published' }>;
};

export type PhaseDiscordEventPayload = {
  [K in keyof PhaseNotificationEventMap]: {
    version: 1;
    owner: { kind: 'phase'; phase_id: string; season_id: string };
    event_type: K;
    data: PhaseNotificationEventMap[K];
  }
}[keyof PhaseNotificationEventMap];

export type PhaseSocialEventPayload = PhaseDiscordEventPayload & { imageUrl?: string };
