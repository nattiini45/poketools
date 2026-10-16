/**
 * Smogon-backed agent tools (PRD §5, Layer 3 — strategy knowledge):
 *   - getUsageStats          — top-N usage for a format (+ per-mon moves/items/abilities/spreads)
 *   - searchStrategyKnowledge — Smogon analysis + recommended-set excerpts for a query
 *
 * Both read the preprocessed Smogon data hosted at https://data.pkmn.cc via the
 * `@pkmn/smogon` rich client (analyses/sets) and a direct stats fetch (format-wide
 * usage, which the per-species client API does not expose). Results are pure
 * JSON-serializable objects, capped in size, and memoized in a 24h in-memory LRU
 * cache keyed by format (the underlying data files are per-format).
 */
import { Smogon } from '@pkmn/smogon';
import type { Analysis, DisplayStatistics } from '@pkmn/smogon';
import { getGeneration, getSpecies } from '@/lib/pkmn/dex';
import { LruCache } from '@/lib/utils/lru-cache';
import type { GetUsageStatsInput, SearchStrategyKnowledgeInput } from './schemas';

// ─── Smogon client (minimal mode → per-format fetches, less bandwidth) ──

const DATA_URL = 'https://pkmn.github.io/smogon/data';

const fetchJson = (url: string) =>
  fetch(url.replace('https://data.pkmn.cc/', 'https://pkmn.github.io/smogon/data/'));

// `minimal = true` so analyses/sets only fetch the requested format file
// instead of an entire generation's worth of data (~15MB).
const smogon = new Smogon(fetchJson, true);

// ─── 24h in-memory LRU cache (mirrors pkmn.ts) ───────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_ENTRIES = 100;

const cache = new LruCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

// ─── Result shapes ───────────────────────────────────────────────────

interface UsageEntry {
  name: string;
  /** Weighted usage as a percentage (0–100). */
  pct: number;
}

export interface UsageStatsPokemon {
  pokemon: string;
  /** Weighted usage of this Pokémon in the format (0–100). */
  usage_pct: number;
  /** Raw (unweighted) appearance count. */
  raw_count: number;
  moves: UsageEntry[];
  items: UsageEntry[];
  abilities: UsageEntry[];
  /** EV/nature spreads, e.g. "Jolly:0/252/0/0/4/252". */
  spreads: UsageEntry[];
  teraTypes: UsageEntry[];
}

export interface GetUsageStatsResult {
  format: string;
  /** Total battles the report was computed from. */
  battles: number;
  /** Top Pokémon by weighted usage (capped). */
  pokemon: UsageStatsPokemon[];
}

export interface StrategyExcerpt {
  pokemon: string;
  format: string;
  source: 'smogon-analysis';
  text: string;
}

export interface SearchStrategyKnowledgeResult {
  query: string;
  format: string | null;
  excerpts: StrategyExcerpt[];
}

// ─── Caps ────────────────────────────────────────────────────────────

const MAX_POKEMON = 20;
const MAX_SUBLIST = 5;
const MAX_EXCERPTS = 3;
const EXCERPT_MAX_CHARS = 800;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Top-N entries of a `{ name: weight }` map, weight rendered as a 0–100 %. */
function topEntries(map: Record<string, number> | undefined, n: number): UsageEntry[] {
  if (!map) return [];
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, weight]) => ({ name, pct: Math.round(weight * 1000) / 10 }));
}

function genFromFormat(format?: string, fallbackGen?: number): number {
  if (fallbackGen) return fallbackGen;
  const m = format?.match(/^gen(\d)/i);
  if (m) return Number(m[1]);
  return 9;
}

async function fetchFormatStats(format: string): Promise<DisplayStatistics | null> {
  const key = `stats:${format.toLowerCase()}`;
  const cached = cache.get<DisplayStatistics | null>(key);
  if (cached !== undefined) return cached;

  let stats: DisplayStatistics | null = null;
  try {
    const res = await fetch(`${DATA_URL}/stats/${format}.json`);
    if (res.ok) {
      stats = (await res.json()) as DisplayStatistics;
    }
  } catch {
    stats = null;
  }
  cache.set(key, stats);
  return stats;
}

// ─── getUsageStats ───────────────────────────────────────────────────

export async function getUsageStats(input: GetUsageStatsInput): Promise<GetUsageStatsResult> {
  const format = input.format;
  const stats = await fetchFormatStats(format);

  if (!stats || !stats.pokemon) {
    return { format, battles: 0, pokemon: [] };
  }

  const ranked = Object.entries(stats.pokemon)
    .map(([name, data]) => ({ name, data }))
    .sort((a, b) => (b.data.usage?.weighted ?? 0) - (a.data.usage?.weighted ?? 0))
    .slice(0, MAX_POKEMON);

  const pokemon: UsageStatsPokemon[] = ranked.map(({ name, data }) => {
    // `stats` (modern) or `spreads` (legacy reports) holds the EV/nature spreads.
    const spreadMap =
      (data as { stats?: Record<string, number> }).stats ??
      (data as { spreads?: Record<string, number> }).spreads;
    return {
      pokemon: name,
      usage_pct: Math.round((data.usage?.weighted ?? 0) * 1000) / 10,
      raw_count: data.usage?.raw ?? data.count ?? 0,
      moves: topEntries(data.moves, MAX_SUBLIST),
      items: topEntries(data.items, MAX_SUBLIST),
      abilities: topEntries(data.abilities, MAX_SUBLIST),
      spreads: topEntries(spreadMap, MAX_SUBLIST),
      teraTypes: topEntries(data.teraTypes, MAX_SUBLIST),
    };
  });

  return { format, battles: stats.battles ?? 0, pokemon };
}

// ─── searchStrategyKnowledge ─────────────────────────────────────────

/** Find species names mentioned in a free-text query (longest match first). */
function findSpeciesInQuery(query: string, gen: number): string[] {
  const q = query.toLowerCase();

  // Fast path: the whole query is a species name.
  const direct = getSpecies(query.trim(), gen);
  if (direct && direct.exists) return [direct.name];

  const matches: string[] = [];
  for (const species of Array.from(getGeneration(gen).species)) {
    if (!species.exists) continue;
    if (q.includes(species.name.toLowerCase())) matches.push(species.name);
  }
  // Longer names first so "Iron Valiant" wins over "Iron".
  return matches.sort((a, b) => b.length - a.length).slice(0, MAX_EXCERPTS);
}

/** Build a single trimmed strategy excerpt from a Smogon analysis. */
function analysisToText(analysis: Analysis): string {
  const parts: string[] = [];
  if (analysis.overview) parts.push(analysis.overview.trim());
  if (analysis.comments) parts.push(analysis.comments.trim());

  for (const [setName, set] of Object.entries(analysis.sets)) {
    const moves = (set.moves ?? [])
      .map((m) => (Array.isArray(m) ? m.join(' / ') : m))
      .filter(Boolean)
      .join(', ');
    const ability = Array.isArray(set.ability) ? set.ability.join(' / ') : set.ability;
    const item = Array.isArray(set.item) ? set.item.join(' / ') : set.item;
    const bits = [`Set "${setName}"`];
    if (moves) bits.push(`moves: ${moves}`);
    if (ability) bits.push(`ability: ${ability}`);
    if (item) bits.push(`item: ${item}`);
    if (set.description) bits.push(set.description.trim());
    parts.push(bits.join(' — '));
  }

  return parts.join('\n').slice(0, EXCERPT_MAX_CHARS);
}

export async function searchStrategyKnowledge(
  input: SearchStrategyKnowledgeInput,
): Promise<SearchStrategyKnowledgeResult> {
  const gen = genFromFormat(input.format, input.gen);
  const format = input.format ?? null;

  // Resolve which Pokémon to pull analyses for.
  let targets = findSpeciesInQuery(input.query, gen);

  // No specific Pokémon named → fall back to top-usage mons, optionally
  // filtered by query keywords (simple includes-matching).
  if (targets.length === 0 && format) {
    const usage = await getUsageStats({ format });
    const keywords = input.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const filtered = usage.pokemon.filter((p) =>
      keywords.some((k) => p.pokemon.toLowerCase().includes(k)),
    );
    const pool = filtered.length > 0 ? filtered : usage.pokemon;
    targets = pool.slice(0, MAX_EXCERPTS).map((p) => p.pokemon);
  }

  const generation = getGeneration(gen);
  const formatId = format ? (format.toLowerCase() as Parameters<typeof smogon.analyses>[2]) : undefined;
  const excerpts: StrategyExcerpt[] = [];

  for (const speciesName of targets) {
    if (excerpts.length >= MAX_EXCERPTS) break;
    let analyses: Analysis[] = [];
    try {
      analyses = await smogon.analyses(generation, speciesName, formatId);
    } catch {
      analyses = [];
    }
    for (const analysis of analyses) {
      if (excerpts.length >= MAX_EXCERPTS) break;
      const text = analysisToText(analysis);
      if (!text) continue;
      excerpts.push({
        pokemon: speciesName,
        format: analysis.format ?? format ?? '',
        source: 'smogon-analysis',
        text,
      });
    }
  }

  return { query: input.query, format, excerpts };
}

// ─── Test-only cache reset ───────────────────────────────────────────

/** Clear the in-memory cache. Intended for unit tests only. */
export function __clearSmogonToolCache(): void {
  cache.clear();
}
