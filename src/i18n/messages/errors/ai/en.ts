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
 * / `ai_report_failed` next to their English `error`.
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

  // Agent settings
  ai_model_ids_unknown: 'Unrecognized model ID: {ids}',

  // Teambuilder coaches (`api/teams/ai/{slot-coach,team-coach}`)
  ai_coach_format_invalid: 'Invalid format',
  ai_coach_generation_invalid: 'Invalid generation',
  ai_coach_species_required: 'A Pokémon set with species is required',
  ai_coach_team_empty: 'At least one Pokémon is required',
} as const;
