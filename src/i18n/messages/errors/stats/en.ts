/**
 * Error catalog `errors/stats` (owner A8, i18n-core §4.1): the stats and usage
 * routes (`api/stats`, `api/usage-stats/**`, `api/pokemon/**`), the species
 * tools (`api/pkmn/{stats,speed-calc,evo-chain}`, sweep L12), the image
 * proxy (`api/proxy-image`), replay frames (`api/replay-frames`) and the wiki
 * routes except search (`api/wiki/{abilities,items,moves,notes}/**`; search is
 * PK-5's and uses `errors/common` only).
 *
 * `en` is the current English server message, verbatim (templates as
 * `{param}` placeholders); the server keeps sending its own English `error`,
 * and clients translate by `code`. Shared failures use `errors/common`
 * (`validation_failed`, `rate_limited`). `{pokemon}` carries the English
 * @pkmn name from the request, so a client localizes it through the pkmn layer.
 */
export default {
  // Aggregate stats (`api/stats`, `api/pokemon/[name]/stats`)
  stats_view_invalid: 'view must be usage, raw, or moves',
  stats_move_filter_length: 'move must be 1-{max} characters',
  stats_scope_invalid: 'scope must be tournament, league, or all_time',
  stats_scope_id_required: 'scope_id required for tournament and league scopes',
  stats_scope_id_invalid: 'scope_id must be a valid UUID',

  // Usage cache (`api/usage-stats/**`)
  usage_format_required: 'format query param is required',
  usage_no_data: 'No usage data for {pokemon}',

  // Species lookup (`api/pokemon/[name]`)
  pokemon_not_found: 'Pokemon "{pokemon}" not found',

  // Species tools (`api/pkmn/{stats,speed-calc,evo-chain}`)
  unknown_species: 'Unknown species: {pokemon}',
  evo_chain_unsupported:
    '"{pokemon}" does not have a single 3-stage evolution line. It may be a 2-stage Pokémon, have branching evolutions, or not exist.',

  // Image proxy (`api/proxy-image`)
  proxy_url_missing: 'Missing url parameter',
  proxy_url_invalid: 'Invalid URL',
  proxy_https_only: 'Only HTTPS URLs are allowed',
  proxy_url_not_allowed: 'Domain or path not allowed',
  proxy_upstream_failed: 'Upstream fetch failed',
  proxy_upstream_not_image: 'Upstream did not return an image',

  // Replay frames (`api/replay-frames`)
  replay_url_missing: 'Missing required parameter: url',
  replay_url_invalid: 'Invalid replay URL or ID',

  // Wiki entries and community notes (`api/wiki/**` minus search)
  wiki_ability_not_found: 'Ability not found',
  wiki_item_not_found: 'Item not found',
  wiki_move_not_found: 'Move not found',
  wiki_note_not_found: 'Note not found',
  wiki_note_edit_forbidden: 'Not authorized to edit this note',
  wiki_note_delete_forbidden: 'Not authorized to delete this note',
  wiki_note_approve_reject_conflict: 'A note cannot be approved and rejected in the same request',
  wiki_note_content_required: 'content is required',
} as const;
