/**
 * Error catalog `errors/draft-legacy` (owner DL-API after the G0-ERR seed,
 * i18n-core §4.1, draft-backend §8.6). Lower-case codes of the legacy draft
 * routes (`api/{evolutions,point-buy-lists,team-roles,draft-pool-entries,
 * draft-pool-templates,draft-tier-limits}`, `api/seasons/[id]/{progress,
 * evolution-points,redraft/{phase,trade-request,trade-requests}}`,
 * `api/admin/import/{point-buy,team-roles}`) and of `src/lib/{draft,evolution}`.
 * The point-buy reconciliation report's finding codes are report fields, not
 * API errors, and are not catalogued here.
 *
 * `en` is the route's current English `error` (clients on English show the
 * server's own text). Where the route forwards a database reason token
 * (`trade_*` codes mapped from the trade RPC), `en` is the readable sentence
 * for that token. Validation failures and malformed JSON use the shared
 * `errors/common` codes (`validation_failed`, `invalid_json`); a missing
 * league uses `errors/seasons` `season_not_found`.
 */
export default {
  // G0-ERR seed (verbatim)
  list_version_immutable:
    'This point-buy list version is bound to an active or completed season and cannot be modified. Create a new version instead.',
  season_list_binding_locked: 'Only upcoming seasons can be bound to a different point-buy list version',
  epb_team_invalid: 'This team is not valid under the Evolution Point Buy rules: {issues}',
  suspended_line_in_team:
    '{species} is suspended for matchday {matchday} and cannot be included in the final team',

  // Shared by several legacy draft routes
  draft_season_id_required: 'season_id is required',
  draft_update_empty: 'No valid fields to update',

  // Legacy pool order and pricing (api/drafts create, api/drafts/[id]/picks)
  draft_auction_order_not_free: 'Auction drafts need free pick order: the winning bidder gets the pick',
  draft_roster_full: 'This player already has all {max} picks',
  draft_budget_below_rounds:
    'A budget of {budget} cannot fill {rounds} picks at the default price of {price} (needs {minimum})',
  draft_pick_strands_roster:
    'After this pick only {remaining_after} points would be left, but the remaining {slots} picks cost at least {min_cost} points.',
  // Switch to free order (api/drafts/[id]/free-order)
  draft_free_order_not_running: 'Only a running draft can switch to free order',
  draft_free_order_already_free: 'This draft already uses free order',

  // Evolution tiers (api/evolutions)
  evolution_tiers_empty: 'At least one tier is required',
  evolution_tiers_mixed_season: 'All bulk tiers must share the same season_id',
  evolution_stage2_required: 'stage2_pokemon is required',
  evolution_tier_not_found: 'Evolution tier not found',

  // Draft pool entries and templates
  pool_entries_empty: 'At least one entry is required',
  pool_entries_mixed_season: 'All bulk entries must share the same season_id',
  pool_entry_not_found: 'Pool entry not found',
  pool_template_not_found: 'Template not found',

  // Point-buy lists
  point_buy_list_not_found: 'Point-buy list not found',
  point_buy_list_unbound: 'No point-buy list is bound to this season',

  // Progress corrections (api/seasons/[id]/progress)
  progress_tracker_not_in_season: 'Tracker not found in this season',
  progress_audit_unreadable: 'Correction applied but audit entry could not be read back',

  // Redraft phase and trade requests
  redraft_hinrunde_incomplete: 'Cannot open redraft until the Hinrunde (first half) is complete',
  redraft_phase_not_open: 'Redraft phase is not open for this season',
  trade_source_trackers_required: 'Both source trackers are required to initiate a trade',
  trade_request_not_found: 'Trade request not found',
  trade_request_wrong_season: 'Trade request does not belong to this season',
  trade_not_participant: 'You are not a participant in this trade',
  trade_already_executed: 'Trade is already executed',
  trade_already_cancelled: 'Trade is already cancelled',
  trade_no_longer_pending: 'Trade is no longer pending',
  trade_side_a_invalid: 'Player A side failed: {reason}',
  trade_side_b_invalid: 'Player B side failed: {reason}',
  // Reasons the trade RPC (`epb_execute_trade_request`) raises; the route maps them
  trade_request_not_executable: 'This trade can no longer be executed.',
  trade_multiple_draft_pools: 'This season has more than one draft pool, so the trade cannot be checked.',
  trade_insufficient_points: 'A player no longer has enough points for this trade.',
  trade_source_tracker_unavailable: 'A traded line is no longer owned by its player.',
  trade_line_already_owned: 'Line {pokemon} is already owned by another player',
  trade_execution_rejected: 'The trade was rejected: {reason}',

  // Trade sides (lib/draft/trade-consent.ts); {side} is the side letter A or B
  trade_source_tracker_not_found: 'Source tracker for player {side} not found',
  trade_line_not_owned: 'The offered line {side} does not belong to player {side}',
  trade_line_not_in_list: 'The offered line {side} is not part of the bound point-buy list',
  trade_line_untradeable: '{pokemon} cannot be traded',
  trade_line_pending: 'One of these lines already has a pending trade',
  trade_line_gone: 'A selected line is no longer available',
  trade_line_left_list: 'A traded line is no longer part of the bound point-buy list',

  // Legacy redraft route (api/seasons/[id]/redraft)
  redraft_state_not_own: 'You can only view your own redraft state',
  redraft_lines_not_own: 'You can only redraft your own lines',
  redraft_target_line_not_in_list: 'Target line not found in the bound point-buy list',
  trade_admin_only: 'Trades are executed by an admin on behalf of both players',
  trade_partner_required: 'trade_partner_id is required for trades',
  trade_target_not_partner_line: 'Target line is not owned by the trade partner',
  trade_source_tracker_missing: 'Source tracker not found for this player',
  trade_offered_line_not_in_list: 'The offered line is not part of the bound point-buy list',

  // Swap refusals (lib/draft/redraft-engine.ts prepareRedraftSwap)
  redraft_line_excluded: '{pokemon} cannot be obtained via redraft',
  redraft_source_missing: 'Source tracker not found',
  redraft_line_not_owned: 'You do not own this line',
  redraft_line_untradeable: '{pokemon} cannot be traded away',
  redraft_insufficient_points: 'Not enough points for upgrade. Need {cost}, have {remaining}',

  // Workbook imports (api/admin/import/{point-buy,team-roles}, src/lib/import/xlsx-upload.ts)
  import_name_required: 'name is required',
  import_version_invalid: 'version must be a positive integer',
  xlsx_file_missing: 'No file uploaded',
  xlsx_extension_invalid: 'File must be an .xlsx workbook',
  xlsx_type_invalid: 'Invalid file type — expected .xlsx',
  xlsx_file_empty: 'Uploaded file is empty',
  xlsx_file_too_large: 'File exceeds {limit} MB limit',
  xlsx_zip_header_missing: 'File is not a valid .xlsx workbook (missing ZIP header)',
} as const;
