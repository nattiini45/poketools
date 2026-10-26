/**
 * Per-player context pack (PRD §8.1).
 *
 * A small, server-built, JSON-serialisable object injected into the system
 * prompt on every chat request so the assistant opens already knowing the
 * player — replacing 3–4 reflexive opening tool calls with zero (PRD §8).
 *
 * Sections (profile, upcoming matches, recent results, H2H vs the upcoming
 * opponent, active team) are fetched concurrently where possible and each
 * **soft-fails to null** — the pack must never throw, so one bad section can't
 * sink the whole request. All reads use the service-role Supabase client and
 * the existing query modules (no new SQL).
 */
import { supabase } from '@/lib/supabase/client';
import {
  getUpcomingMatches,
  getMatchesByPlayer,
  getMatchById,
  getH2HBetweenPlayers,
} from '@/lib/supabase/queries/matches';
import { getTeamById } from '@/lib/supabase/queries/teams';
import { getTournamentById, getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getParticipantCore } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getOpponentBattleStatsInTournament } from '@/lib/supabase/queries/games';
import { renderAllowlists, renderTeamConstraints } from '@/lib/ai/league-context';
import type { MatchWithPlayers } from '@/types/match';
import type { Team } from '@/types/team';
import type { Ruleset, TeamConstraints } from '@/types/ruleset';
import type { CoreTriple, Season } from '@/types/season';
import type { Tournament } from '@/types/tournament';
import type { BattleStat } from '@/types/game';
import type { AgentContext } from './types';

// ─── Pack shape ──────────────────────────────────────────────────────

export interface ContextPackProfile {
  favorite_pokemon: string[];
  preferred_formats: string[];
  play_style_tags: string[];
  default_persona: string;
}

export interface ContextPackMatch {
  match_id: string;
  opponent_name: string;
  status: string;
  scheduled_at: string | null;
}

export interface ContextPackResult {
  opponent_name: string;
  result: 'win' | 'loss' | null;
  score: string;
  date_played: string | null;
}

export interface ContextPackH2H {
  opponent_name: string;
  wins: number;
  losses: number;
  matches: number;
}

export interface ContextPackTeam {
  team_id: string;
  name: string;
  format_hint: string | null;
  pokemon: string[];
}

/**
 * The active league's effective ruleset + the player's assigned core, so the
 * teambuilding assistant builds within the league's rules — not just the base
 * format. Resolved via {@link resolveEffectiveRuleset} so a base-tier ruleset id
 * is upgraded to the league's custom ruleset where one exists.
 */
export interface ContextPackLeague {
  /** The league/season name (its identity for this request), when resolvable. */
  league_name: string | null;
  /** The league's own prose rules (season + tournament description). */
  description: string | null;
  ruleset_name: string;
  /** The version of the pinned ruleset the league enforces; null for a ruleset built in code. */
  ruleset_version: number | null;
  /** The effective ruleset's id — the assistant passes this to buildTeam. */
  ruleset_id: string | null;
  base_format: string;
  clauses: string[];
  bans: Ruleset['bans'];
  /** Lists in allowlist mode: the only legal entries (null for a list that is not an allowlist). */
  allow: Ruleset['allow'];
  additions: string[];
  custom_rules: string | null;
  team_constraints: TeamConstraints | null;
  player_core: CoreTriple | null;
}

/** One Pokémon line in a scouting block (a player's recent usage in this league). */
export interface ContextPackScoutMon {
  pokemon: string;
  brought: number;
  led: number;
  kos_dealt: number;
}

/** A player's recent Pokémon usage in the current league (player or opponent). */
export interface ContextPackScout {
  /** Display label ("You" for the player, or the opponent's name). */
  name: string;
  /** The subject's player id — pass to getMatchHistory to pull their full history. */
  player_id: string;
  /** Distinct games observed in scope. */
  games: number;
  pokemon: ContextPackScoutMon[];
}

export interface ContextPack {
  player_id: string;
  format?: string;
  profile: ContextPackProfile | null;
  upcoming_matches: ContextPackMatch[] | null;
  recent_results: ContextPackResult[] | null;
  head_to_head: ContextPackH2H | null;
  active_team: ContextPackTeam | null;
  league: ContextPackLeague | null;
  /** The player's own recent Pokémon in this league (plan mode). */
  player_recent_pokemon: ContextPackScout | null;
  /** The upcoming opponent's recent Pokémon in this league (plan mode). */
  opponent_scout: ContextPackScout | null;
}

// ─── Caps (keep the rendered block well under ~1500 tokens) ──────────

const MAX_UPCOMING = 3;
const MAX_RECENT = 5;
const MAX_SCOUT_MONS = 8;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Run a section loader; a failure degrades that section to an explicit `null`
 * so the rest of the pack still renders (PRD §8.1). The original error is
 * always logged with the section name first, so a failing read stays visible
 * in the server logs and distinguishable from "no data".
 */
async function safe<T>(section: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error(`[ai/agent/context-pack] ${section} read failed:`, err);
    return null;
  }
}

function opponentOf(match: MatchWithPlayers, playerId: string): { id: string; name: string } {
  return match.player_1_id === playerId
    ? { id: match.player_2_id, name: match.player_2_name }
    : { id: match.player_1_id, name: match.player_1_name };
}

function scoreFor(match: MatchWithPlayers, playerId: string, opponentId: string): string {
  let mine = 0;
  let theirs = 0;
  for (const g of match.games) {
    if (g.winner_id === playerId) mine++;
    else if (g.winner_id === opponentId) theirs++;
  }
  return `${mine}-${theirs}`;
}

function teamPokemonNames(team: Team): string[] {
  return team.pokemon.map((p) => p.species).filter((s): s is string => !!s);
}

// ─── buildContextPack ────────────────────────────────────────────────

export async function buildContextPack(
  playerId: string,
  context?: AgentContext,
): Promise<ContextPack> {
  const [profile, upcomingMatches, recentMatches, activeTeam] = await Promise.all([
    safe('profile', () => loadProfile(playerId)),
    safe('upcoming matches', () => getUpcomingMatches(playerId)),
    safe('recent matches', () => getMatchesByPlayer(playerId)),
    context?.team_id ? safe('active team', () => getTeamById(context.team_id as string)) : Promise.resolve(null),
  ]);

  // Resolve match → tournament → season → ruleset → core ONCE; reused by every
  // league-aware section below (record scoping, H2H, league ruleset, scouting).
  const scope = await resolveLeagueScope(playerId, upcomingMatches ?? [], context);

  const upcoming: ContextPackMatch[] | null = upcomingMatches
    ? upcomingMatches.slice(0, MAX_UPCOMING).map((m) => {
        const opp = opponentOf(m, playerId);
        return {
          match_id: m.id,
          opponent_name: opp.name,
          status: m.status,
          scheduled_at: m.scheduled_at,
        };
      })
    : null;

  // Recent results — scoped to the CURRENT league (season: groups + playoffs) when
  // known, so the record reflects this league, not every league ever played.
  const recent = buildRecentResults(recentMatches, playerId, scope.seasonTournamentIds);

  // H2H vs the target opponent (tournament-scoped).
  const head_to_head = await safe('head-to-head', () => loadH2H(playerId, scope));

  // League ruleset + assigned core (plan mode only) — derived from the scope, no refetch.
  const league = buildLeagueSection(scope, context);

  // Past-Pokémon scouting (plan mode only): the player's own and the opponent's
  // recent mons IN THIS LEAGUE, so the assistant opens already knowing both sides.
  const opp = scope.opponent;
  const [playerScout, opponentScout] = await Promise.all([
    safe('player scout', () => loadScout(playerId, 'You', scope)),
    opp ? safe('opponent scout', () => loadScout(opp.id, opp.name, scope)) : Promise.resolve(null),
  ]);

  // The active team is the CALLER'S team being built. Any other player's row
  // (even one they could see elsewhere) is never put into the prompt: a
  // foreign team id must not leak a planned roster (spec §7).
  const ownTeam = activeTeam && activeTeam.player_id === playerId ? activeTeam : null;
  const active_team: ContextPackTeam | null = ownTeam
    ? {
        team_id: ownTeam.id,
        name: ownTeam.name,
        // Teams are linked to a tournament/season, not a format string directly.
        format_hint: null,
        pokemon: teamPokemonNames(ownTeam),
      }
    : null;

  return {
    player_id: playerId,
    format: context?.format,
    profile,
    upcoming_matches: upcoming,
    recent_results: recent,
    head_to_head,
    active_team,
    league,
    player_recent_pokemon: playerScout,
    opponent_scout: opponentScout,
  };
}

// ─── League scope (resolved once, shared by every league-aware section) ──

interface LeagueScope {
  /** The match this prep is for (explicit id wins; else the first upcoming). */
  target: MatchWithPlayers | null;
  /** The opponent in that match. */
  opponent: { id: string; name: string } | null;
  tournament: Tournament | null;
  season: Season | null;
  /** All tournament ids in the season — league-scoped record (groups + playoffs). */
  seasonTournamentIds: string[] | null;
  /** The effective custom league ruleset (base-tier upgraded where one exists). */
  ruleset: Ruleset | null;
  /** The player's assigned core types for this season, if any. */
  playerCore: CoreTriple | null;
}

/**
 * Resolve the match → tournament → season → effective ruleset → assigned core
 * chain once. The league ruleset, league-scoped record and scouting only apply in
 * plan mode (a ruleset id or explicit match was forwarded); the plain teambuilder
 * keeps its prior behavior (H2H vs the next match, record across all leagues).
 * Every sub-step soft-fails to null so one bad read never sinks the pack.
 */
async function resolveLeagueScope(
  playerId: string,
  upcoming: MatchWithPlayers[],
  context?: AgentContext,
): Promise<LeagueScope> {
  let target: MatchWithPlayers | null = null;
  if (context?.upcoming_match_id) {
    const explicitId = context.upcoming_match_id;
    target = upcoming.find((m) => m.id === explicitId) ?? (await safe('target match', () => getMatchById(explicitId)));
  } else {
    target = upcoming[0] ?? null;
  }
  const opponent = target ? opponentOf(target, playerId) : null;

  const hasLeagueContext = !!(context?.ruleset_id || context?.upcoming_match_id);

  let tournament: Tournament | null = null;
  let season: Season | null = null;
  let ruleset: Ruleset | null = null;
  let playerCore: CoreTriple | null = null;
  let seasonTournamentIds: string[] | null = null;

  if (hasLeagueContext && target) {
    const tgt = target;
    tournament = await safe('tournament', () => getTournamentById(tgt.tournament_id));
    if (tournament) {
      const t = tournament;
      season = t.season_id ? await safe('season', () => getSeasonById(t.season_id as string)) : null;
      const s = season;
      // The phase's own pin: an immutable ruleset version.
      ruleset = await safe('ruleset', () => getRulesetById(t.ruleset_id));
      if (s) {
        playerCore = await safe('participant core', () => getParticipantCore(s.id, playerId));
        const stages = await safe('season stages', () => getStagesBySeasonId(s.id));
        seasonTournamentIds = stages && stages.length ? stages.map((x) => x.id) : [t.id];
      }
    }
  }

  // Fallback: trust the client-supplied ruleset id when no match scope resolved one.
  if (hasLeagueContext && !ruleset && context?.ruleset_id) {
    const rid = context.ruleset_id;
    ruleset = await safe('ruleset', () => readExposedRuleset(rid));
  }

  return { target, opponent, tournament, season, seasonTournamentIds, ruleset, playerCore };
}

/**
 * Map the player's completed matches to recent-result lines, scoped to the current
 * league (season tournaments) when known. Without a season scope the prior
 * all-leagues behavior is kept (plain teambuilder).
 */
function buildRecentResults(
  recentMatches: MatchWithPlayers[] | null,
  playerId: string,
  seasonTournamentIds: string[] | null,
): ContextPackResult[] | null {
  if (!recentMatches) return null;
  const inScope = seasonTournamentIds
    ? recentMatches.filter((m) => seasonTournamentIds.includes(m.tournament_id))
    : recentMatches;
  return inScope
    .filter((m) => m.status === 'completed')
    .slice(0, MAX_RECENT)
    .map((m) => {
      const opp = opponentOf(m, playerId);
      return {
        opponent_name: opp.name,
        result: m.winner_id ? (m.winner_id === playerId ? 'win' : 'loss') : null,
        score: scoreFor(m, playerId, opp.id),
        date_played: m.date_played,
      };
    });
}

/**
 * Build the league ruleset section from the resolved scope. Returns null outside
 * plan mode, or when there is neither a ruleset nor an assigned core to report.
 */
function buildLeagueSection(
  scope: LeagueScope,
  context?: AgentContext,
): ContextPackLeague | null {
  if (!context?.ruleset_id && !context?.upcoming_match_id) return null;
  const { ruleset, playerCore, season, tournament } = scope;
  if (!ruleset && !playerCore) return null;

  const descriptionParts: string[] = [];
  // The league's own prose rules — many leagues express rules here, not only in
  // structured constraints. Forward them verbatim so the assistant reasons about
  // WHATEVER this league requires, not a fixed format.
  if (season?.description?.trim()) descriptionParts.push(season.description.trim());
  if (tournament?.description?.trim()) descriptionParts.push(tournament.description.trim());

  return {
    league_name: season?.name ?? null,
    description: descriptionParts.length ? descriptionParts.join('\n\n') : null,
    ruleset_name: ruleset?.name ?? 'Custom league ruleset',
    ruleset_version: ruleset?.version?.version_no ?? null,
    ruleset_id: ruleset?.id ?? null,
    base_format: ruleset?.base_format ?? context.format ?? 'unknown',
    clauses: ruleset?.clauses ?? [],
    bans: ruleset?.bans ?? { pokemon: [], moves: [], items: [], abilities: [] },
    allow: ruleset?.allow ?? { pokemon: null, moves: null, items: null, abilities: null },
    additions: ruleset?.additions.pokemon ?? [],
    custom_rules: ruleset?.custom_rules_string?.trim() || null,
    team_constraints: ruleset?.team_constraints ?? null,
    player_core: playerCore,
  };
}

/**
 * Aggregate a player's recent Pokémon usage in the current league (tournament,
 * auto-expanding to season scope on small samples) into a compact scouting block.
 * Returns null when there is no completed-game data to report.
 */
async function loadScout(
  subjectId: string,
  subjectName: string,
  scope: LeagueScope,
): Promise<ContextPackScout | null> {
  if (!scope.tournament) return null;
  const stats = await getOpponentBattleStatsInTournament(
    subjectId,
    scope.tournament.id,
    scope.season?.id ?? null,
  );
  if (!stats.length) return null;
  return aggregateScout(subjectName, subjectId, stats);
}

/** Fold raw battle stats into per-Pokémon usage, sorted by bring count. */
function aggregateScout(
  name: string,
  playerId: string,
  stats: BattleStat[],
): ContextPackScout {
  const map = new Map<string, { brought: number; led: number; kos: number }>();
  for (const s of stats) {
    if (!s.was_brought) continue;
    const e = map.get(s.pokemon_name) ?? { brought: 0, led: 0, kos: 0 };
    e.brought++;
    if (s.was_lead) e.led++;
    e.kos += s.kos_dealt;
    map.set(s.pokemon_name, e);
  }
  const pokemon: ContextPackScoutMon[] = Array.from(map.entries())
    .sort(([, a], [, b]) => b.brought - a.brought)
    .slice(0, MAX_SCOUT_MONS)
    .map(([pokemon, e]) => ({ pokemon, brought: e.brought, led: e.led, kos_dealt: e.kos }));
  const games = new Set(stats.map((s) => s.game_id)).size;
  return { name, player_id: playerId, games, pokemon };
}

async function loadProfile(playerId: string): Promise<ContextPackProfile | null> {
  const { data, error } = await supabase
    .from('user_agent_profile')
    .select('favorite_pokemon, preferred_formats, play_style_tags, default_persona')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    favorite_pokemon: data.favorite_pokemon ?? [],
    preferred_formats: data.preferred_formats ?? [],
    play_style_tags: data.play_style_tags ?? [],
    default_persona: data.default_persona,
  };
}

async function loadH2H(
  playerId: string,
  scope: LeagueScope,
): Promise<ContextPackH2H | null> {
  const { target, opponent } = scope;
  if (!target || !opponent) return null;

  const history = await getH2HBetweenPlayers(playerId, opponent.id, target.tournament_id);
  let wins = 0;
  let losses = 0;
  for (const m of history) {
    if (m.winner_id === playerId) wins++;
    else if (m.winner_id === opponent.id) losses++;
  }
  return { opponent_name: opponent.name, wins, losses, matches: history.length };
}

/** One scouting line: "Pokémon (brought N, led M, K KOs)". */
function formatScoutMon(m: ContextPackScoutMon): string {
  const bits = [`brought ${m.brought}`];
  if (m.led) bits.push(`led ${m.led}`);
  if (m.kos_dealt) bits.push(`${m.kos_dealt} KOs`);
  return `${m.pokemon} (${bits.join(', ')})`;
}

// ─── renderContextPack ───────────────────────────────────────────────

/**
 * Render the pack as a terse markdown block for the system prompt. Capped well
 * under ~1500 tokens by the section limits above; null sections are omitted.
 */
export function renderContextPack(pack: ContextPack): string {
  const lines: string[] = ['## Player context'];

  if (pack.profile) {
    const p = pack.profile;
    const bits: string[] = [];
    if (p.favorite_pokemon.length) bits.push(`favourites: ${p.favorite_pokemon.join(', ')}`);
    if (p.preferred_formats.length) bits.push(`formats: ${p.preferred_formats.join(', ')}`);
    if (p.play_style_tags.length) bits.push(`style: ${p.play_style_tags.join(', ')}`);
    lines.push(`- Profile — ${bits.length ? bits.join('; ') : 'no preferences set'}`);
  }

  if (pack.format) lines.push(`- Active format: ${pack.format}`);

  if (pack.upcoming_matches && pack.upcoming_matches.length) {
    lines.push('- Upcoming matches:');
    for (const m of pack.upcoming_matches) {
      const when = m.scheduled_at ? ` @ ${m.scheduled_at}` : '';
      lines.push(`  - vs ${m.opponent_name} (${m.status})${when}`);
    }
  }

  if (pack.head_to_head) {
    const h = pack.head_to_head;
    lines.push(
      `- H2H vs ${h.opponent_name}: ${h.wins}-${h.losses} over ${h.matches} prior match(es)`,
    );
  }

  if (pack.opponent_scout && pack.opponent_scout.pokemon.length) {
    const o = pack.opponent_scout;
    lines.push(`- ${o.name}'s recent Pokémon in this league (${o.games} game(s)):`);
    for (const m of o.pokemon) lines.push(`  - ${formatScoutMon(m)}`);
    lines.push(
      `  - For ${o.name}'s full match history, call getMatchHistory with playerId "${o.player_id}".`,
    );
  }

  if (pack.recent_results && pack.recent_results.length) {
    lines.push('- Recent results:');
    for (const r of pack.recent_results) {
      const outcome = r.result ?? 'pending';
      lines.push(`  - ${outcome} ${r.score} vs ${r.opponent_name}`);
    }
  }

  if (pack.player_recent_pokemon && pack.player_recent_pokemon.pokemon.length) {
    const me = pack.player_recent_pokemon;
    lines.push(`- Your recent Pokémon in this league (${me.games} game(s)):`);
    for (const m of me.pokemon) lines.push(`  - ${formatScoutMon(m)}`);
  }

  if (pack.active_team) {
    const t = pack.active_team;
    const mons = t.pokemon.length ? t.pokemon.join(', ') : '(empty)';
    lines.push(`- Active team "${t.name || 'unnamed'}": ${mons}`);
  }

  // League ruleset is authoritative for legality — render it as its own section
  // so the assistant treats it as binding, not a soft hint.
  if (pack.league) {
    const l = pack.league;
    lines.push('');
    lines.push(`## League ruleset: ${l.league_name ?? l.ruleset_name}`);
    lines.push(
      'These are the rules for THIS request. Build only within them — read the description and constraints below and comply with whatever this specific league requires (do not assume a fixed format).',
    );
    lines.push(`- Base format: ${l.base_format}`);
    lines.push(`- Ruleset: ${l.ruleset_name}${l.ruleset_version === null ? '' : `, version ${l.ruleset_version}`}`);
    if (l.ruleset_id) {
      lines.push(`- Ruleset id (pass this exact id as ruleset_id to buildTeam): ${l.ruleset_id}`);
    }
    if (l.description) lines.push(`- League rules (read carefully): ${l.description}`);
    if (l.clauses.length) lines.push(`- Clauses: ${l.clauses.join(', ')}`);
    const banLine = (label: string, arr: string[]) => {
      if (!arr.length) return;
      const shown = arr.slice(0, 30).join(', ');
      const extra = arr.length > 30 ? ` (+${arr.length - 30} more)` : '';
      lines.push(`- Banned ${label}: ${shown}${extra}`);
    };
    banLine('Pokémon', l.bans.pokemon);
    banLine('moves', l.bans.moves);
    banLine('items', l.bans.items);
    banLine('abilities', l.bans.abilities);
    for (const line of renderAllowlists(l.allow)) lines.push(`- ${line}`);
    if (l.additions.length) {
      lines.push(`- Unbanned (additions): ${l.additions.slice(0, 30).join(', ')}`);
    }
    if (l.custom_rules) lines.push(`- Custom rules: ${l.custom_rules}`);
    for (const c of renderTeamConstraints(l.team_constraints)) lines.push(`- ${c}`);
    if (l.player_core) {
      lines.push(
        `- Your assigned core types: ${l.player_core.join(' / ')}. Every team must satisfy this league's type quota for each of these types (and any tera rule). Pass these as player_core and this ruleset's id when you call buildTeam.`,
      );
    } else if (l.team_constraints?.type_quotas?.source === 'player_core') {
      lines.push(
        '- Your core types are not assigned yet for this league, so the type quota cannot be checked — note this to the player rather than inventing a core.',
      );
    }
  }

  if (lines.length === 1) lines.push('- (no context available)');
  return lines.join('\n');
}
