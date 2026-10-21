import {
  getTeamByShareToken,
  getTeamVisibilityFacts,
  type TeamLead,
  type TeamLeadWithFacts,
  type TeamVisibilityFacts,
} from '@/lib/supabase/queries/teams';
import { toPublicTeam, type PublicTeam } from '@/lib/team/public-team';
import type { Team, TeamLibraryEntry, PokemonSet, SharedTeamView, StatSpread } from '@/types/team';
import type { MatchStatus } from '@/types/match';
import type { TeamVisibility } from '@/types/tournament';

/** One placeholder set for a hidden roster slot (a fresh object per call). */
function redactedSet(): PokemonSet {
  return {
    name: '',
    species: 'hidden',
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: '',
    level: 100,
    moves: [],
  };
}

/**
 * A fresh redacted roster (six placeholder sets) for one hidden team. Each
 * call returns new objects, so a caller that mutates its copy (a serializer,
 * a test) can never change what another response shows.
 */
export function redactedPokemon(): PokemonSet[] {
  return Array.from({ length: 6 }, redactedSet);
}

/** A `PokemonSet` that cannot be changed at any depth. */
export type FrozenPokemonSet = Readonly<Omit<PokemonSet, 'evs' | 'ivs' | 'moves'>> & {
  readonly evs: Readonly<StatSpread>;
  readonly ivs: Readonly<StatSpread>;
  readonly moves: readonly string[];
};

/**
 * The redacted roster as a deeply frozen constant, for comparisons only
 * (tests, equality checks). Responses use `redactedPokemon()`.
 */
export const REDACTED_POKEMON: readonly FrozenPokemonSet[] = Object.freeze(
  redactedPokemon().map((set) =>
    Object.freeze({
      ...set,
      evs: Object.freeze({ ...set.evs }),
      ivs: Object.freeze({ ...set.ivs }),
      moves: Object.freeze([...set.moves]),
    })
  )
);

/** Who is looking at a team. `viewerId` is null for anonymous visitors. */
export interface TeamViewer {
  viewerId: string | null;
  isAdmin: boolean;
}

// ── Team-level visibility (spec §7) ──────────────────────────────────
//
// Spec §7 (`canViewTeam`): the owner always sees their team, admins always
// see it, and everyone else sees it once its match is completed; hidden
// otherwise. Team-level routes and pages (team lists, team detail, the
// public league team pages) apply it per ROW:
//
//   admin                                   -> visible
//   owner                                   -> visible
//   published to the library                -> visible (the owner made it public)
//   tournament team_visibility always_public -> visible (spec §4.3 setting)
//   row linked to a completed match          -> visible (teams.match_id)
//   anything else (planned, unused, personal) -> hidden
//
// There is no "the owner has some completed match" term: a planned team
// stays hidden until a match it is linked to completes, even when its owner
// already finished other matches. The share link (`filterTeamForShare`) and
// the library (`filterLibraryEntryForDisplay`) are their own paths.

type TeamVisibilityInput = Pick<Team, 'player_id' | 'match_id' | 'library_published_at'>;

/** True when the decision needs no database facts (admin, owner, library). */
function visibleWithoutFacts(team: TeamVisibilityInput, viewer: TeamViewer): boolean {
  if (viewer.isAdmin) return true;
  if (viewer.viewerId !== null && viewer.viewerId === team.player_id) return true;
  return Boolean(team.library_published_at);
}

/**
 * The spec §7 decision for one team row, given its facts (pure). Missing
 * facts (`undefined`: the row was not found) decide hidden.
 */
export function decideTeamPokemonVisibility(
  team: TeamVisibilityInput,
  viewer: TeamViewer,
  facts: TeamVisibilityFacts | undefined
): boolean {
  if (visibleWithoutFacts(team, viewer)) return true;
  if (!facts) return false;
  if (facts.tournament_visibility === 'always_public') return true;
  return Boolean(team.match_id) && facts.match_status === 'completed';
}

/**
 * Decide spec §7 visibility for every row of `teams`, in order. Reads the
 * facts (linked match status, tournament setting) once for all rows that
 * the viewer alone does not decide; an admin's or owner's view reads nothing.
 */
export async function resolveTeamVisibility(
  teams: readonly Team[],
  viewer: TeamViewer
): Promise<boolean[]> {
  const undecided = teams.filter((team) => !visibleWithoutFacts(team, viewer));
  const facts =
    undecided.length > 0
      ? await getTeamVisibilityFacts(undecided.map((team) => team.id))
      : new Map<string, TeamVisibilityFacts>();
  return teams.map((team) => decideTeamPokemonVisibility(team, viewer, facts.get(team.id)));
}

/**
 * Spec §7 for an ANONYMOUS visitor, from a row's database facts alone: the
 * tournament is `always_public`, or the row's linked match is completed.
 * Missing facts (the row was not found) decide hidden. Pure. Library
 * publication is deliberately not a term here: the only caller is the world
 * aces, which show what the league's matches fielded (spec §7, aces paragraph).
 */
export function isVisibleToAnonymous(facts: TeamVisibilityFacts | undefined): boolean {
  if (!facts) return false;
  return facts.tournament_visibility === 'always_public' || facts.match_status === 'completed';
}

/**
 * The leads an anonymous visitor may see (`isVisibleToAnonymous` on each
 * lead's own facts), reduced to the plain lead slice, in order: the public
 * world aces of every league, including hidden_until_match leagues, whose
 * played (completed-match) teams are public. Pure.
 */
export function selectAnonymousVisibleLeads(leads: readonly TeamLeadWithFacts[]): TeamLead[] {
  return leads
    .filter((lead) => isVisibleToAnonymous(lead.facts))
    .map(({ id, player_id, updated_at, lead_species }) => ({ id, player_id, updated_at, lead_species }));
}

/** The public shape of `team`, with its roster redacted unless `visible`. */
export function toVisibleTeam(team: Team, visible: boolean): PublicTeam {
  const publicTeam = toPublicTeam(team);
  if (visible) return publicTeam;
  publicTeam.pokemon = redactedPokemon();
  return publicTeam;
}

/**
 * Apply spec §7 to a list of teams for `viewer`: every row comes back as a
 * `PublicTeam` (no share columns), hidden rows with `redactedPokemon()`.
 */
export async function filterTeamVisibility(
  teams: readonly Team[],
  viewer: TeamViewer
): Promise<PublicTeam[]> {
  const visible = await resolveTeamVisibility(teams, viewer);
  return teams.map((team, i) => toVisibleTeam(team, visible[i]));
}

/**
 * One row per player for the public league team pages: a player can hold a
 * planned row plus one row per match (`teams.match_id`). Shows the player's
 * newest VISIBLE row (by `created_at`), else their first row (hidden).
 * Players keep the order of their first row. `visible[i]` belongs to
 * `teams[i]` (from `resolveTeamVisibility`).
 */
export function pickDisplayTeams(
  teams: readonly Team[],
  visible: readonly boolean[]
): { team: Team; visible: boolean }[] {
  const picked = new Map<string, { team: Team; visible: boolean }>();
  teams.forEach((team, i) => {
    const current = picked.get(team.player_id);
    const isVisible = visible[i] === true;
    if (!current) {
      picked.set(team.player_id, { team, visible: isVisible });
      return;
    }
    if (isVisible && (!current.visible || team.created_at > current.team.created_at)) {
      picked.set(team.player_id, { team, visible: true });
    }
  });
  return [...picked.values()];
}

// ── Match-scoped surfaces (spec §7) ──────────────────────────────────
//
// The broadcast preview, the tracker, caster data, cast populate and the AI
// match context show the rosters of ONE match. Spec §7 decides each roster
// against that match's own status:
//
//   admin                                    -> visible
//   owner                                    -> visible
//   published to the library                 -> visible
//   tournament team_visibility always_public -> visible
//   the match is completed                   -> visible
//   anything else (scheduled, in progress)   -> hidden
//
// Nothing about the owner's OTHER matches counts: a roster for an upcoming
// match stays hidden even when its owner already finished other matches.
// Creators get no extra grant (spec §7 names only admin); routes pass the
// viewer's real `isAdmin`. The row itself comes from `getPlayerTeamForMatch`.

/** The match a match-scoped roster is shown for. */
export interface RosterMatch {
  status: MatchStatus;
}

/**
 * The spec §7 decision for the roster `team` brings to `match` (pure).
 * `tournamentVisibility` is the match's tournament `team_visibility`
 * (null when the tournament was not found: decides like `hidden_until_match`).
 */
export function decideMatchRosterVisibility(
  team: TeamVisibilityInput,
  viewer: TeamViewer,
  match: RosterMatch,
  tournamentVisibility: TeamVisibility | null
): boolean {
  if (visibleWithoutFacts(team, viewer)) return true;
  if (tournamentVisibility === 'always_public') return true;
  return match.status === 'completed';
}

/**
 * The roster of `team` for `match` as the anonymous broadcast preview shows
 * it: `[]` without a team, the sets when spec §7 allows an anonymous viewer,
 * `redactedPokemon()` otherwise.
 */
export function filterTeamPokemonForBroadcast(
  team: Team | null,
  match: RosterMatch,
  tournamentVisibility: TeamVisibility | null
): PokemonSet[] {
  if (!team) return [];
  const visible = decideMatchRosterVisibility(
    team,
    { viewerId: null, isAdmin: false },
    match,
    tournamentVisibility
  );
  return visible ? team.pokemon : redactedPokemon();
}

/** A side's match-prep roster (`match_prep_teams`) for one match. */
export interface MatchPrepRoster {
  player_id: string;
  pokemon: PokemonSet[];
}

/** The match a pair of match-prep rosters belongs to. */
export interface MatchPrepRosterMatch extends RosterMatch {
  id: string;
  player_1_id: string;
  player_2_id: string;
}

/**
 * The match-prep rosters `viewer` may see for `match`, one per side, decided
 * per side by spec §7 (`decideMatchRosterVisibility`): the viewer's own side,
 * both sides for an admin, an `always_public` tournament or a completed match.
 * A hidden side or a side without a row comes back as `[]`, never as the
 * redacted placeholder (the result pre-fills a form). `undefined` when no
 * side is visible. Prep rows are never library-published.
 */
export function selectVisibleMatchPrepRosters(
  rows: readonly MatchPrepRoster[],
  match: MatchPrepRosterMatch,
  viewer: TeamViewer,
  tournamentVisibility: TeamVisibility | null
): { player1: PokemonSet[]; player2: PokemonSet[] } | undefined {
  const sideRoster = (playerId: string): PokemonSet[] => {
    const row = rows.find((r) => r.player_id === playerId);
    if (!row) return [];
    const visible = decideMatchRosterVisibility(
      { player_id: row.player_id, match_id: match.id, library_published_at: null },
      viewer,
      match,
      tournamentVisibility
    );
    return visible ? row.pokemon : [];
  };
  const player1 = sideRoster(match.player_1_id);
  const player2 = sideRoster(match.player_2_id);
  if (player1.length === 0 && player2.length === 0) return undefined;
  return { player1, player2 };
}

// ── Fork access ──────────────────────────────────────────────────────

/** Outcome of `checkTeamForkAccess`; each refusal has its own error code. */
export type TeamForkAccess = 'allowed' | 'source_private' | 'share_token_invalid';

/**
 * Whether a player may fork `source`: a library-published team may be forked
 * by anyone signed in; a team that is only shared needs its share token (the
 * same authorization as viewing it through the share link). Without a token
 * an unpublished team is `source_private`, whether or not it is shared, so the
 * answer does not reveal that a share link exists.
 */
export async function checkTeamForkAccess(
  source: Team,
  shareToken?: string
): Promise<TeamForkAccess> {
  if (source.library_published_at) return 'allowed';
  if (!shareToken) return 'source_private';
  const shared = await getTeamByShareToken(shareToken);
  return shared !== null && shared.id === source.id ? 'allowed' : 'share_token_invalid';
}

// ── Share link visibility ─────────────────────────────────────────────

/**
 * Teams accessed via share link are always fully visible.
 * The share token itself acts as the authorization — if you have the token,
 * you can see the full team. No auth context needed.
 */
export function filterTeamForShare(team: Team): SharedTeamView {
  return {
    id: team.id,
    pokemon: team.pokemon.filter((p) => p && p.species),
    library_title: team.library_title,
    library_description: team.library_description,
    tournament_id: team.tournament_id,
    created_at: team.created_at,
  };
}

// ── Public library visibility ────────────────────────────────────────

/**
 * Library entries are always fully visible — the pokemon data is public
 * once published. The library listing already filters to only published teams.
 */
export function filterLibraryEntryForDisplay(entry: TeamLibraryEntry): TeamLibraryEntry {
  return entry;
}
