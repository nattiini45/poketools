import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  broadcast_match_id_required: 'match_id ist erforderlich.',
  moment_create_forbidden: 'Du darfst für dieses Spiel keine Momente anlegen.',

  preset_not_found: 'Preset nicht gefunden.',
  preset_update_forbidden: 'Du darfst dieses Preset nicht bearbeiten.',
  preset_delete_forbidden: 'Du darfst dieses Preset nicht löschen.',

  recap_params_required: 'Die Abfrageparameter tournament_id und round_id sind erforderlich.',
  solo_session_not_found: 'Solo-Session nicht gefunden.',
  storyline_season_id_required: 'season_id ist erforderlich.',

  cast_session_not_found: 'Session nicht gefunden.',
  INVALID_SESSION_ID: 'Session nicht gefunden.',
  INVALID_STORYLINE_ID: 'Storyline nicht gefunden.',
  cast_session_forbidden: 'Dazu bist du nicht berechtigt.',

  webhook_not_found: 'Webhook nicht gefunden.',
  discord_webhook_test_rejected: 'Discord hat die Testnachricht abgelehnt (HTTP {status}).',
  discord_webhook_test_unreachable: 'Discord ist nicht erreichbar.',
  discord_webhook_url_invalid: 'Die gespeicherte Webhook-URL ist keine gültige Discord-Webhook-URL.',

  social_integration_not_found: 'Integration nicht gefunden.',
  social_credentials_conflict: 'Gib entweder neue Zugangsdaten an oder lösch die vorhandenen – nicht beides.',
  social_credentials_provider_mismatch: 'Die Zugangsdaten gehören zu einem anderen Anbieter als die Integration.',
  social_credentials_field_required: 'Für {provider} fehlt in den Zugangsdaten das Feld {field}.',
  INVALID_PRESET_ID: 'Preset nicht gefunden.',
  INVALID_WEBHOOK_ID: 'Webhook nicht gefunden.',
  INVALID_INTEGRATION_ID: 'Integration nicht gefunden.',
});
