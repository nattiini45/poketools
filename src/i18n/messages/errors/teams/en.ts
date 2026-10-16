/**
 * Error catalog `errors/teams` (owner A2, i18n-core §4.1): teams, the team
 * library and share links, team import (Showdown text / pokepast.es), team
 * validation, sample sets and match prep.
 *
 * `en` is the current English server message, verbatim; the server keeps
 * sending its own English `error`, and clients translate by `code`.
 * Validation, rate-limit and auth-guard failures use the shared
 * `errors/common` codes (`validation_failed`, `rate_limited`, `forbidden`),
 * and match-prep's missing `match_id` / unknown match reuse
 * `errors/matches` (`MISSING_PARAM`, `match_not_found`).
 *
 * Tournament and ruleset look-ups made by the team routes send
 * `tournament_not_found` / `ruleset_not_found` from `errors/tournaments`.
 */
export default {
  // Teams (`/api/teams`, `/api/teams/[id]`)
  team_not_found: 'Team not found',
  team_list_forbidden: "Cannot view other players' teams",
  team_submission_closed: 'Tournament is completed — team submission is closed',
  team_not_tournament_participant: 'You are not a participant in this tournament',
  team_already_submitted: 'You already have a team for this tournament',
  team_not_owner: 'Not your team',
  team_locked: 'Team is locked',

  // Team library (`/api/teams/library/**`)
  team_library_entry_not_found: 'Team not found or not published',
  team_fork_source_not_found: 'Source team not found',
  team_fork_source_private: 'Source team is not publicly accessible',

  // Share links (`/api/teams/share`, `/api/teams/shared/[token]`)
  team_share_site_url_missing: 'Server misconfiguration: site URL not set',
  team_share_token_invalid: 'Invalid token',
  team_shared_not_found: 'Team not found or link expired',

  // Import and validation (`/api/import-team`, `/api/validate-team`)
  team_import_pokepaste_url_invalid: 'Invalid pokepast.es URL',
  team_import_pokepaste_fetch_failed: 'Failed to fetch from pokepast.es',
  team_import_no_pokemon: 'Could not parse any Pokémon from the provided text',

  // Sample sets (`/api/sample-sets`)
  sample_sets_pokemon_required: 'pokemon query param is required',

  // Match prep (`/api/match-prep`)
  match_prep_not_participant: 'You are not a participant in this match',
  match_prep_target_not_participant: 'Target player is not a participant in this match',
} as const;
