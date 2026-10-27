/**
 * N: operations that are NOT tools (plan 3.6.8, spec §18.1). The assistant says so plainly and links to the admin page;
 * a hallucinated tool name from this list (or any unknown name) is answered with `tool_not_available`.
 *
 * No entry here may be registered as a tool (`__tests__/registry.test.ts`), and a tool is never added to this list's
 * territory later without an owner decision. The paths are admin pages, so they work as deep links.
 */
export interface NotATool {
  /** What the model might call it. */
  readonly names: readonly string[];
  /** What the admin does instead. */
  readonly adminPath: string;
}

export const NOT_TOOLS: readonly NotATool[] = [
  { names: ['delete_phase', 'delete_tournament', 'delete_ruleset', 'delete_format', 'delete_draft_pool', 'delete_league', 'hard_delete_league'], adminPath: '/admin/leagues' },
  { names: ['restore_league', 'rebuild_league', 'purge_league'], adminPath: '/admin/leagues/trash' },
  { names: ['create_webhook', 'update_webhook', 'test_webhook', 'configure_social'], adminPath: '/admin/social' },
  { names: ['grant_resource_admin', 'revoke_resource_admin'], adminPath: '/admin/leagues' },
  { names: ['create_guest_player', 'create_test_player', 'mint_login', 'set_test_season'], adminPath: '/admin/players' },
  { names: ['create_point_buy_list', 'import_point_buy_list'], adminPath: '/admin/data' },
  { names: ['void_draft', 'correct_draft', 'end_draft', 'restore_draft', 'free_order', 'undo_pick', 'clear_pool', 'replace_pool_entries'], adminPath: '/admin/leagues' },
  { names: ['regenerate_bracket', 'reset_round', 'reset_match', 'generate_all_rounds', 'create_manual_rounds'], adminPath: '/admin/leagues' },
  { names: ['set_format_gallery', 'set_ruleset_gallery', 'create_legacy_ruleset', 'seed_rulesets'], adminPath: '/admin/rulesets' },
  { names: ['post_to_discord', 'send_discord_message', 'post_to_social'], adminPath: '/admin/social' },
];

/** Every name the model could mistake for a tool, flat. */
export const NOT_TOOL_NAMES: ReadonlySet<string> = new Set(NOT_TOOLS.flatMap((entry) => entry.names));

/** The admin page for a name that is not a tool, or `null` for an unknown name. */
export function notToolPath(name: string): string | null {
  return NOT_TOOLS.find((entry) => entry.names.includes(name))?.adminPath ?? null;
}
