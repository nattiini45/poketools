/**
 * Error catalog `errors/draft-legacy`. Lower-case codes of the legacy draft
 * routes (`api/{evolutions,point-buy-lists,team-roles,draft-pool-entries,
 * draft-pool-templates,draft-tier-limits}`, `api/seasons/[id]/{progress,
 * evolution-points,redraft/phase}`,
 * `api/admin/import/{point-buy,team-roles}`) and of `src/lib/{draft,evolution}`.
 * The point-buy reconciliation report's finding codes are report fields, not
 * API errors, and are not catalogued here.
 *
 * `en` is the route's current English `error` (clients on English show the
 * server's own text). Validation failures and malformed JSON use the shared
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
  /** A league with groups drafts per group, which only the queue engine (Evolution Point Buy) runs. */
  draft_groups_need_point_buy:
    'This league has groups. Groups draft separately, which only Evolution Point Buy leagues support. Remove the groups on the Participants tab to run one draft for everyone.',
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
  // A path id that is not a UUID names no list (404 before the query)
  INVALID_POINT_BUY_LIST_ID: 'Point-buy list not found',
  point_buy_list_unbound: 'No point-buy list is bound to this season',

  // Progress corrections (api/seasons/[id]/progress)
  progress_tracker_not_in_season: 'Tracker not found in this season',
  progress_audit_unreadable: 'Correction applied but audit entry could not be read back',

  // Redraft phase (api/seasons/[id]/redraft/phase)
  redraft_hinrunde_incomplete: 'Cannot open redraft until the Hinrunde (first half) is complete',

  // Legacy redraft state read (GET api/seasons/[id]/redraft)
  redraft_state_not_own: 'You can only view your own redraft state',

  // Workbook imports (api/admin/import/{point-buy,team-roles}, src/lib/import/xlsx-upload.ts)
  import_name_required: 'name is required',
  import_version_invalid: 'version must be a positive integer',
  xlsx_file_missing: 'No file uploaded',
  xlsx_extension_invalid: 'File must be an .xlsx workbook',
  xlsx_type_invalid: 'Invalid file type — expected .xlsx',
  xlsx_file_empty: 'Uploaded file is empty',
  xlsx_file_too_large: 'File exceeds {limit} MB limit',
  xlsx_zip_header_missing: 'File is not a valid .xlsx workbook (missing ZIP header)',
  INVALID_EVOLUTION_TIER_ID: 'Evolution tier not found',
  INVALID_POOL_ENTRY_ID: 'Pool entry not found',
  INVALID_POOL_TEMPLATE_ID: 'Template not found',
} as const;
