/**
 * What each Go-live action posts to the outside world (plan 3.6.7 "Outward effect listed on the card", X5).
 *
 * Outward effects are Discord webhooks and social posts (X, Threads, Bluesky), fired by the same routes the admin UI
 * uses; nothing goes by email or DM. One table is the source for the G tools' `outwardEffects` (the invariant test
 * requires a declaration on every G tool) and for the `outward_effects_preview` reader, so the card, the tool text and
 * the preview cannot drift apart. The strings are fixed English text, never stored text.
 */
import type { OutwardEffect } from './types';

const DISCORD_SOCIAL = 'Posts to the Discord webhooks and social accounts that match this league or tournament';

export const OUTWARD: Readonly<Record<string, readonly OutwardEffect[]>> = {
  start_phase: [
    { key: 'round_generated', summary: `${DISCORD_SOCIAL}: the first round pairings, with player names` },
    { key: 'tournament_started', summary: `${DISCORD_SOCIAL}: that the tournament has started` },
    { key: 'league_active', summary: 'The league becomes active and its start is visible on the public pages' },
    { key: 'ai_forecast', summary: 'May generate an AI forecast when that is enabled for the league' },
  ],
  generate_round: [{ key: 'round_generated', summary: `${DISCORD_SOCIAL}: the new round pairings, with player names` }],
  generate_bracket: [
    { key: 'round_generated', summary: `${DISCORD_SOCIAL}: the full bracket` },
    { key: 'enrollment_frozen', summary: 'The league becomes active and the phase enrollment freezes' },
  ],
  start_round: [{ key: 'round_started', summary: 'The round is opened to play; no Discord or social post is made for opening alone' }],
  complete_round: [{ key: 'round_recap', summary: `${DISCORD_SOCIAL}: the round recap, with an AI recap when that is enabled` }],
  advance_phase: [{ key: 'season_advanced', summary: `${DISCORD_SOCIAL}: that the league moved to the next phase; the next phase enrollment is replaced` }],
  complete_tournament: [{ key: 'tournament_completed', summary: `${DISCORD_SOCIAL}: the final result, again on every re-completion` }],
  league_status: [{ key: 'league_status', summary: 'Changes the league status on every public page; a custom-format league needs an attached format first' }],
  league_trash: [{ key: 'league_trashed', summary: 'The league leaves every list and moves to the recycle bin for 90 days; only a superadmin can restore it' }],
  draft_start: [{ key: 'draft_started', summary: 'Pings seat 1 on Discord and starts the live pick clock' }],
  draft_activate_legacy_pool: [{ key: 'draft_picks_open', summary: 'Players can pick, and every pick posts to Discord' }],
  redraft_create: [{ key: 'redraft_open', summary: 'Opens secret drops for the redraft to the league' }],
  redraft_publish: [{ key: 'redraft_published', summary: 'Reveals the redraft results and posts them' }],
  publish_ruleset: [
    { key: 'immutable_version', summary: 'Creates an immutable ruleset version that can never be edited or removed from a league that pins it' },
    { key: 'shared_selectable', summary: 'When the ruleset is shared with league admins or the gallery, other admins can select it' },
  ],
  move_pin: [
    { key: 'live_rules_change', summary: 'Changes the live rules of the named leagues and phases; teams already submitted may become invalid' },
  ],
  publish_format: [
    { key: 'immutable_version', summary: 'Creates an immutable format version; the format can no longer be deleted' },
    { key: 'visible_to_admins', summary: 'Refreshes the name and description other admins see' },
  ],
  set_format_visibility: [{ key: 'format_shared', summary: 'Shows the published format to all admin tiers' }],
  attach_format: [
    { key: 'phases_created', summary: 'Creates the league phases and one league-owned, private, published ruleset per distinct rule-preset stage; re-attaching replaces the format' },
  ],
  detach_format: [{ key: 'phases_deleted', summary: 'Deletes the phases the attach created and the unused league-owned rulesets; refused after the start' }],
  undo: [{ key: 'compensating_changes', summary: 'Applies compensating changes for what this conversation wrote, each with its own precondition; nothing is hard-deleted' }],
};

/** The keys of `OUTWARD`, in a fixed order, as the `action` of `outward_effects_preview`. */
export const OUTWARD_ACTIONS = Object.keys(OUTWARD) as [keyof typeof OUTWARD & string, ...(keyof typeof OUTWARD & string)[]];

/** Actions whose events go to Discord and social (the ones the recipient preview can count). */
export const POSTING_ACTIONS: ReadonlySet<string> = new Set([
  'start_phase',
  'generate_round',
  'generate_bracket',
  'complete_round',
  'advance_phase',
  'complete_tournament',
  'draft_start',
  'draft_activate_legacy_pool',
  'redraft_publish',
]);
