import type { DiscordWebhook, DiscordWebhookView, CreateWebhookInput, UpdateWebhookInput } from './discord';
import type { SocialIntegration, SocialIntegrationWithSecrets } from './social';

export interface PhaseDiscordWebhook extends Omit<DiscordWebhook, 'scope_type' | 'scope_id'> {
  phase_id: string;
}

export interface PhaseDiscordWebhookView extends Omit<DiscordWebhookView, 'scope_type' | 'scope_id'> {
  phase_id: string;
}

export type CreatePhaseWebhookInput = Omit<CreateWebhookInput, 'scope_type' | 'scope_id'> & { phase_id: string };
export type UpdatePhaseWebhookInput = UpdateWebhookInput;

export interface PhaseSocialIntegration extends Omit<SocialIntegration, 'scope_type' | 'scope_id'> {
  phase_id: string;
}

export interface PhaseSocialIntegrationWithSecrets extends PhaseSocialIntegration,
  Pick<SocialIntegrationWithSecrets, 'credentials_encrypted'> {}
