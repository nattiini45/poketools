/**
 * Error catalog `errors/broadcast` (owner A8, i18n-core §4.1): the broadcast
 * overlay and Cast Studio routes (`api/broadcast/**`, `api/cast-sessions/**`)
 * and the outbound integration managers (`api/discord-webhooks/**`,
 * `api/social-integrations/**`).
 *
 * `en` is the current English server message, verbatim (templates as
 * `{param}` placeholders); the server keeps sending its own English `error`,
 * and clients translate by `code`. Shared failures use `errors/common`
 * (`validation_failed`, `not_found_generic`), and the not-found codes of the
 * resource's own domain (`match_not_found` from `errors/matches`,
 * `season_not_found` from `errors/seasons`, `tournament_not_found` /
 * `round_not_found` from `errors/tournaments`): a client of these routes
 * passes those catalogs to `useApiErrorText` too.
 */
export default {
  // Broadcast moments (`api/broadcast/moments`)
  broadcast_match_id_required: 'match_id is required',
  moment_create_forbidden: 'Not authorized to create moments for this match',

  // Overlay presets (`api/broadcast/presets/**`)
  preset_not_found: 'Preset not found',
  preset_update_forbidden: 'Not authorized to update this preset',
  preset_delete_forbidden: 'Not authorized to delete this preset',

  // Overlay data (`api/broadcast/{recap,solo,storylines}/**`)
  recap_params_required: 'tournament_id and round_id query parameters are required',
  solo_session_not_found: 'Solo session not found',
  storyline_season_id_required: 'season_id required',

  // Cast Studio sessions (`api/cast-sessions/**`)
  cast_session_not_found: 'Session not found',
  cast_session_forbidden: 'Not authorized',

  // Discord webhooks (`api/discord-webhooks/**`)
  webhook_not_found: 'Webhook not found',

  // Social integrations (`api/social-integrations/**`); `provider` is the
  // provider label from `src/lib/social/validation.ts` (X, Threads, Bluesky),
  // `field` the missing credential field name.
  social_integration_not_found: 'Integration not found',
  social_credentials_conflict: 'Provide either credentials or clear_credentials, not both',
  social_credentials_provider_mismatch: 'credentials.provider must match integration provider',
  social_credentials_field_required: '{provider} credentials require {field}',
} as const;
