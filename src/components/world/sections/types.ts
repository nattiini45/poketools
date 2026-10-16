import type { WorldRouteData, WorldRosterTile } from '@/lib/worlds/route-data';
import type { SeasonFormatType, SeasonWithDetails } from '@/types/season';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { FormatRules } from '@/types/format-rules';
import type { Locale } from '@/i18n/config';

/**
 * The viewer's languages for a server-rendered world section or panel (i18n
 * D11: worlds follow the viewer). The world root reads them once on the
 * server (`getLocale()` / `getDataLocale()`) and threads them down; a missing
 * `locale` renders English, a missing `dataLocale` follows `locale`.
 */
export interface WorldLocaleProps {
  /** UI language of the copy. */
  locale?: Locale;
  /** Language of Pokémon names (the viewer may keep them English). */
  dataLocale?: Locale;
}

/**
 * The shared data view every route theme's league sections render from (C1).
 *
 * Sakura, mountain and clouds each declared their own structurally identical
 * copy of this interface; the three sections differed only in diegetic nouns.
 * This is that shape, declared once. Each theme's own `*RouteData` stays in
 * place and remains assignable here structurally, so no theme adapter changed.
 *
 * Every field is already present on the `WorldRouteData` contract — a theme
 * section never queries Supabase and never imports `@pkmn/dex`, so nothing
 * here may grow a loader.
 */
export interface ThemeRouteData {
  /** The season row; these league sections are season-scoped, so required. */
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  participants: PublicParticipant[];
  /** Point-buy list lines; empty when the season has no list bound. */
  entries: PointBuyListEntry[];
  /** Format-independent roster tiles (EPB lines or participant fallback). */
  rosterTiles: WorldRosterTile[];
  trackers: EvolutionTracker[];
  /**
   * Ace species per player id, derived from team data. This is the ace source
   * for leagues without evolution tracking — without it a non-EPB league's
   * Teams section has no species to name and renders no sprites.
   */
  teamAces: Record<string, string>;
  standings: WorldRouteData['standings'];
  fixtures: WorldRouteData['fixtures'];
  formatRules: FormatRules | null;
  /** Season ruleset name, else the first stage's, else null. */
  rulesetName: string | null;
  /** Whether a draft pool row exists — not merely a bound point-buy list. */
  hasDraftPool: boolean;
}

/** Shaped ruleset of record, as each theme's plaque painter returns it. */
export interface RulesPlaqueCopy {
  rulesetName: string;
  rows: [string, string][];
  note: string | null;
}

/**
 * What a plaque painter needs besides the rules row: the league's format and
 * the best-of of its current stage (`rulesCopyContext` in `./rules-context`
 * builds it from `league` and `stages`). Only Evolution Point Buy seasons
 * have a `format_rules` row, so the painters branch on `format`, never on
 * whether `formatRules` is null: an EPB season without a row runs the league
 * defaults, while any other format (even with a stale row left by a format
 * change) shows its format and best-of instead of draft numbers.
 */
export interface RulesCopyContext {
  format: SeasonFormatType;
  /** The current stage's default best-of; null when the league has no stage yet. */
  bestOf: number | null;
}

/**
 * A theme's plaque painter. Each theme exports its own (`plaqueCopy`,
 * `gatePlaqueCopy`) so the painted in-world plaque and the DOM Rules section
 * can never disagree about the ruleset of record.
 */
export type RulesCopyFn = (
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
) => RulesPlaqueCopy;

/**
 * The only thing that legitimately varies between a theme's league sections:
 * its diegetic vocabulary. Everything else — layout, data derivation,
 * accessibility semantics, link shapes — is shared.
 *
 * The theme builds it in the viewer's language; the section chrome around it
 * comes from the `world` namespace in the same language (`WorldLocaleProps`).
 */
export interface ThemeSectionCopy {
  /** Place name for the Pulse masthead, rendered as `<place> · League Pulse`. */
  place: string;
  /** Schedule: where the upcoming fixtures are painted in-world. */
  scheduleUpcomingPainted: string;
  /** Teams: diegetic intro sentence naming the theme's ace furniture. */
  teamsIntro: string;
  /** Roster: point-buy summary, given the tile count. */
  rosterPointBuy: (count: number) => string;
  /** Roster: empty-state sentence. */
  rosterEmpty: string;
  /** Rules: lead-in before the ruleset name ("The park plays by"). */
  rulesPlaysBy: string;
  /** Rules: heading for the evolution/trade paragraph. */
  rulesSpiritHeading: string;
  /** Rules: where the same numbers are carried in-world (Evolution Point Buy). */
  rulesPlaqueNote: string;
  /**
   * Rules: the same note for every other format, whose plaque carries the
   * format and best-of instead of the EPB draft ledger (PR #65 test pass,
   * R18e: the sakura note described the EPB ledger on a two-row plaque).
   */
  rulesFormatNote: string;
  /** Rules: the theme's plaque painter. */
  rulesCopy: RulesCopyFn;
}
