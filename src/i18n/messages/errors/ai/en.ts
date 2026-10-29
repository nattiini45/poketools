/**
 * Error catalog `errors/ai` (owner A7, i18n-core §4.1): the AI routes
 * (`api/ai/**`: match analysis, scouting, tournament reports, the agent
 * chat / config / team / analyze-match / tournament-report routes) and the
 * teambuilder coaches (`api/teams/ai/**`).
 *
 * `en` is the current English server message, verbatim (templates as
 * `{param}` placeholders); the server keeps sending its own English `error`,
 * and clients translate by `code`. Shared failures use `errors/common`
 * (`validation_failed`, `invalid_json`, `daily_limit_reached`), and the
 * not-found codes of the resource's own domain (`match_not_found`,
 * `tournament_not_found`, `round_not_found`).
 *
 * The SSE `failed` frames of the streamed generators carry `ai_analysis_failed`
 * / `ai_report_failed` next to their English `error`; a failed read of the stored
 * analysis carries `ai_analysis_cache_read_failed` instead.
 */
export default {
  // Who may start a generation
  ai_not_registered_player: 'Not a registered player',
  ai_analysis_participants_only: 'Only match participants or admins can trigger analysis',
  ai_scouting_participants_only: 'Only match participants can trigger scouting',

  // Match status gates (`status` is the raw match status id)
  ai_match_status_invalid: 'Match must be pending_confirmation or completed, got {status}',
  ai_analysis_completed_only: 'Match analysis is only available for completed matches (current: {status})',
  ai_scouting_scheduled_only: 'Scouting is only available for scheduled matches (current: {status})',

  // Streamed generation failed (SSE `failed` frame)
  ai_analysis_failed: 'Analysis failed — please try again later.',
  ai_report_failed: 'Report generation failed — please try again later.',
  // The stored-analysis read failed (a database error, not "no analysis yet")
  ai_analysis_cache_read_failed: 'Could not load the stored analysis — please try again later.',
  // Specific causes of a failed generation (`src/lib/ai/errors.ts`): the answer hit its output
  // cap, the model declined, or the provider rejected the request itself
  ai_output_truncated: 'The AI response was cut off before it was complete — please try again.',
  ai_output_refused: 'The AI declined to produce this response.',
  ai_service_unavailable: 'The AI service is not available right now — please try again later.',

  // Agent settings
  ai_model_ids_unknown: 'Unrecognized model ID: {ids}',

  // Teambuilder coaches (`api/teams/ai/{slot-coach,team-coach}`)
  ai_coach_format_invalid: 'Invalid format',
  ai_coach_generation_invalid: 'Invalid generation',
  ai_coach_species_required: 'A Pokémon set with species is required',
  ai_coach_team_empty: 'At least one Pokémon is required',
} as const;
