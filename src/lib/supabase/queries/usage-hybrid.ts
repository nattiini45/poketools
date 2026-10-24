import type {
  HybridUsageOptions,
  HybridPokemonDetail,
  UsageListItem,
} from '@/types/usage';
import { getUsageByFormat, getPokemonUsageStats } from './meta-usage';
import { getAggregates, getAggregateForPokemon, getTotalGamesInScope } from './aggregates';
import { speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { MATCH_WORD_PREFIX, matchRank } from '@/lib/pkmn/i18n/search';

// ── Hybrid usage list ───────────────────────────────────────────────

/** Bilingual prefix match (exact, prefix or word prefix of the English/German species name). */
function matchesNamePrefix(search: string, pokemonName: string): boolean {
  const rank = matchRank(search, speciesSearchKeys(pokemonName));
  return rank >= 0 && rank <= MATCH_WORD_PREFIX;
}

/**
 * Above this many candidate names the DB filter stays the English `ilike` prefix (a one-letter query would
 * otherwise send hundreds of names in the request URL).
 */
const MAX_NAME_CANDIDATES = 200;

/**
 * English species names a non-English query stands for, resolved server-side from the pkmn name maps:
 * every species of the format's generation whose English or German
 * name (or one of their words) the query prefix-matches. Returns null when the English `ilike 'q%'` already
 * reaches every candidate, or when there are too many, so the caller keeps the English DB path; otherwise the
 * full candidate list (English matches included) for an exact `in` filter.
 */
async function germanSearchCandidates(search: string, format: string): Promise<string[] | null> {
  const parsedGen = Number(/^gen(\d+)/.exec(format)?.[1] ?? 9);
  const gen = parsedGen >= 1 && parsedGen <= 9 ? parsedGen : 9;
  // Lazy: the dex is only loaded for searches, and this module stays server-side.
  const { getGeneration } = await import('@/lib/pkmn/dex');
  const ilikePrefix = search.toLowerCase();
  const candidates: string[] = [];
  let beyondIlike = false;
  for (const species of getGeneration(gen).species) {
    if (!matchesNamePrefix(search, species.name)) continue;
    candidates.push(species.name);
    if (!species.name.toLowerCase().startsWith(ilikePrefix)) beyondIlike = true;
  }
  if (!beyondIlike || candidates.length > MAX_NAME_CANDIDATES) return null;
  return candidates;
}

/**
 * Merges league-specific aggregate data with public meta usage stats.
 * League data takes priority when available; meta fills gaps.
 */
export async function getHybridUsageList(
  options: HybridUsageOptions
): Promise<{ data: UsageListItem[]; total: number; source: 'league' | 'meta' | 'hybrid' }> {
  const { format, seasonId, tournamentId, limit = 50, offset = 0, minUsage, search } = options;

  // Determine scope for league data
  const scopeType = seasonId ? 'league' as const : tournamentId ? 'tournament' as const : null;
  const scopeId = seasonId ?? tournamentId ?? null;

  // If we have a league/tournament scope, try to get league-specific data
  let leagueMap: Map<string, number> | null = null;
  let totalGamesInScope = 0;

  if (scopeType && scopeId) {
    try {
      const aggregates = await getAggregates(scopeType, scopeId);
      if (aggregates.length > 0) {
        leagueMap = new Map();
        for (const agg of aggregates) {
          leagueMap.set(agg.pokemon_name, agg.total_appearances);
        }
        totalGamesInScope = await getTotalGamesInScope(scopeType, scopeId);
      }
    } catch {
      // League data unavailable — fall through to meta only
      leagueMap = null;
      totalGamesInScope = 0;
    }
  }

  function leagueUsageRatio(appearances: number): number {
    return totalGamesInScope > 0 ? appearances / totalGamesInScope : 0;
  }

  // Fetch meta usage data. An English prefix keeps the DB `ilike`; a German query ("Glu") is resolved to the
  // English names it stands for, so meta-only rows (no league data) are found too.
  const names = search ? await germanSearchCandidates(search, format) : null;
  const meta = await getUsageByFormat(
    format,
    names ? { limit: 200, minUsage, names } : { limit: 200, minUsage, search },
  );

  // Build merged list
  const merged: UsageListItem[] = [];
  const seen = new Set<string>();

  // Add all meta Pokémon with league overlay
  for (const row of meta.data) {
    seen.add(row.pokemon_name);
    const leagueAppearances = leagueMap?.get(row.pokemon_name);
    const isHybrid = leagueAppearances != null;
    merged.push({
      pokemon_name: row.pokemon_name,
      usage_pct: isHybrid ? leagueUsageRatio(leagueAppearances) : row.usage_pct,
      types: [], // Filled by API route via @pkmn/data
      sprite_id: '', // Filled by API route
      source: isHybrid ? 'hybrid' : 'meta',
    });
  }

  // Add league-only Pokémon not in meta
  if (leagueMap) {
    for (const [name, appearances] of leagueMap) {
      if (!seen.has(name)) {
        merged.push({
          pokemon_name: name,
          usage_pct: leagueUsageRatio(appearances),
          types: [],
          sprite_id: '',
          source: 'league',
        });
      }
    }
  }

  // Sort by usage DESC
  merged.sort((a, b) => b.usage_pct - a.usage_pct);

  // Apply search filter if not already applied at DB level. Prefix semantics in both languages: the query must
  // be a prefix of the English or German name (or of one of their words), e.g. "Glu" finds Charizard (Glurak).
  const filtered = search && leagueMap
    ? merged.filter((m) => matchesNamePrefix(search, m.pokemon_name))
    : merged;

  const source = leagueMap
    ? filtered.some((m) => m.source === 'meta') ? 'hybrid' : 'league'
    : 'meta';

  return {
    data: filtered.slice(offset, offset + limit),
    total: filtered.length,
    source,
  };
}

// ── Hybrid Pokémon detail ───────────────────────────────────────────

/**
 * Full detail for one Pokémon, merging league + meta data.
 * Returns null if Pokémon not found in either source.
 */
export async function getHybridPokemonDetail(
  pokemonName: string,
  options: { format: string; seasonId?: string; tournamentId?: string }
): Promise<Omit<HybridPokemonDetail, 'types' | 'base_stats'> | null> {
  const scopeType = options.seasonId
    ? ('league' as const)
    : options.tournamentId
      ? ('tournament' as const)
      : null;
  const scopeId = options.seasonId ?? options.tournamentId ?? null;

  const [meta, leagueAggregate, totalGames] = await Promise.all([
    getPokemonUsageStats(pokemonName, options.format),
    scopeType && scopeId
      ? getAggregateForPokemon(pokemonName, scopeType, scopeId)
      : Promise.resolve(null),
    scopeType && scopeId
      ? getTotalGamesInScope(scopeType, scopeId)
      : Promise.resolve(0),
  ]);

  if (!meta && !leagueAggregate) return null;

  const leagueUsageRatio =
    leagueAggregate && totalGames > 0
      ? leagueAggregate.total_appearances / totalGames
      : null;
  const leagueLeadRatio =
    leagueAggregate && totalGames > 0
      ? leagueAggregate.total_led / totalGames
      : null;

  function movesFromAggregate(moveCounts: Record<string, number>): Record<string, number> {
    const total = Object.values(moveCounts).reduce((sum, n) => sum + n, 0);
    if (total === 0) return {};
    const out: Record<string, number> = {};
    for (const [name, count] of Object.entries(moveCounts)) {
      out[name] = (count / total) * 100;
    }
    return out;
  }

  if (!meta && leagueAggregate) {
    return {
      pokemon_name: leagueAggregate.pokemon_name,
      format: options.format,
      source: 'league',
      usage_pct: leagueUsageRatio ?? 0,
      lead_pct: leagueLeadRatio,
      moves: movesFromAggregate(leagueAggregate.move_counts),
      items: {},
      abilities: {},
      teammates: {},
      spreads: {},
      tera_types: null,
      counters: null,
      viability: null,
    };
  }

  if (!meta) return null;

  let source: 'meta' | 'league' | 'hybrid' = 'meta';
  let usage_pct = meta.usage_pct;
  let lead_pct = meta.lead_pct;

  if (leagueAggregate && scopeType && scopeId && leagueUsageRatio !== null) {
    usage_pct = leagueUsageRatio;
    lead_pct = leagueLeadRatio;
    source = 'hybrid';
  }

  return {
    pokemon_name: meta.pokemon_name,
    format: meta.format,
    source,
    usage_pct,
    lead_pct,
    moves: meta.moves,
    items: meta.items,
    abilities: meta.abilities,
    teammates: meta.teammates,
    spreads: meta.spreads,
    tera_types: meta.tera_types,
    counters: meta.counters,
    viability: meta.viability,
  };
}
