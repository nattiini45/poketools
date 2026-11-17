import type { PhaseDiscordWebhook, PhaseDiscordWebhookView } from '@/types/phase-integrations';
import { webhookUrlHint } from './webhook-view';

export function toPhaseWebhookView(webhook: PhaseDiscordWebhook): PhaseDiscordWebhookView {
  return {
    id: webhook.id, phase_id: webhook.phase_id, label: webhook.label, enabled: webhook.enabled,
    event_filter: webhook.event_filter, format_options: webhook.format_options,
    created_at: webhook.created_at, updated_at: webhook.updated_at,
    webhook_url_hint: webhookUrlHint(webhook.webhook_url),
  };
}
