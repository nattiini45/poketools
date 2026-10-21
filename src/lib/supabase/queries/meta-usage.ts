import { supabase } from '../client';
import { resolveStatsFormat } from '@/lib/pkmn/format-mapping';
import type { Tables } from '@/types/database';
import type { MetaUsageRow } from '@/types/usage';

// ── Read ────────────────────────────────────────────────────────────

/**
 * Map a UI/ruleset format to the slug usage data is stored under.
 * e.g. 'gen9vgc' → 'gen9vgc2025'. This is the single chokepoint for all
 * usage readers (usage-hybrid, speed-benchmarks, threat-list).
 */
function toStatsFormat(format: string): string {
  return resolveStatsFormat(format) ?? format;
}

/**
 * Meta usage rows of a format, by usage descending.
 * `search` is an English name prefix (`ilike 'q%'`). `names` (exact English species names, e.g. resolved
 * server-side from a German query) replaces `search` when given: only those rows are returned.
 */
export async function getUsageByFormat(
  format: string,
  options?: { limit?: number; offset?: number; minUsage?: number; search?: string; names?: readonly string[] }
): Promise<{ data: MetaUsageRow[]; total: number }> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let query = supabase
    .from('meta_usage_cache')
    .select('*', { count: 'exact' })
    .eq('format', toStatsFormat(format))
    .order('usage_pct', { ascending: false });

  if (options?.minUsage) {
    query = query.gte('usage_pct', options.minUsage);
  }

  if (options?.names) {
    if (options.names.length === 0) return { data: [], total: 0 };
    query = query.in('pokemon_name', [...options.names]);
  } else if (options?.search) {
    query = query.ilike('pokemon_name', `${options.search}%`);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []).map(toMetaUsageRow),
    total: count ?? 0,
  };
}

export async function getPokemonUsageStats(
  pokemonName: string,
  format: string
): Promise<MetaUsageRow | null> {
  const { data, error } = await supabase
    .from('meta_usage_cache')
    .select('*')
    .eq('format', toStatsFormat(format))
    .eq('pokemon_name', pokemonName)
    .maybeSingle();

  if (error) throw error;
  return data ? toMetaUsageRow(data) : null;
}

export async function getAvailableFormats(): Promise<string[]> {
  const { data, error } = await supabase
    .from('meta_usage_cache')
    .select('format')
    .order('format');

  if (error) throw error;

  // Deduplicate (select distinct not available in Supabase JS client)
  const formats = new Set((data ?? []).map((r) => r.format));
  return Array.from(formats).sort();
}

export interface UsageCoverageEntry {
  format: string;
  rows: number;
  last_imported: string | null;
}

/**
 * Per-format row counts + freshness for the admin meta-data page.
 * One count query per format (parallel, chunked) — fine for ~50 formats.
 */
export async function getUsageCoverage(formats: string[]): Promise<UsageCoverageEntry[]> {
  const CHUNK = 10;
  const out: UsageCoverageEntry[] = [];

  for (let i = 0; i < formats.length; i += CHUNK) {
    const chunk = formats.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (format) => {
        const { data, count, error } = await supabase
          .from('meta_usage_cache')
          .select('last_imported', { count: 'exact' })
          .eq('format', format)
          .order('last_imported', { ascending: false })
          .limit(1);
        if (error) throw error;
        return {
          format,
          rows: count ?? 0,
          last_imported: data?.[0]?.last_imported ?? null,
        };
      }),
    );
    out.push(...results);
  }

  return out;
}

export async function getLastImportDate(): Promise<Date | null> {
  const { data, error } = await supabase
    .from('meta_usage_cache')
    .select('last_imported')
    .order('last_imported', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? new Date(data.last_imported) : null;
}

// ── Write ───────────────────────────────────────────────────────────

export async function upsertUsageRow(row: {
  format: string;
  pokemon_name: string;
  usage_pct: number;
  lead_pct: number | null;
  moves: Record<string, number>;
  items: Record<string, number>;
  abilities: Record<string, number>;
  teammates: Record<string, number>;
  spreads: Record<string, number>;
  tera_types: Record<string, number> | null;
  counters: Record<string, [number, number, number]> | null;
  viability: number[] | null;
}): Promise<void> {
  const { error } = await supabase
    .from('meta_usage_cache')
    .upsert(
      {
        format: row.format,
        pokemon_name: row.pokemon_name,
        usage_pct: row.usage_pct,
        lead_pct: row.lead_pct,
        moves: row.moves,
        items: row.items,
        abilities: row.abilities,
        teammates: row.teammates,
        spreads: row.spreads,
        tera_types: row.tera_types,
        counters: row.counters,
        viability: row.viability,
        last_imported: new Date().toISOString(),
      },
      { onConflict: 'format,pokemon_name' }
    );

  if (error) throw error;
}

export async function upsertUsageBatch(
  rows: Parameters<typeof upsertUsageRow>[0][]
): Promise<void> {
  if (rows.length === 0) return;

  const records = rows.map((row) => ({
    format: row.format,
    pokemon_name: row.pokemon_name,
    usage_pct: row.usage_pct,
    lead_pct: row.lead_pct,
    moves: row.moves,
    items: row.items,
    abilities: row.abilities,
    teammates: row.teammates,
    spreads: row.spreads,
    tera_types: row.tera_types,
    counters: row.counters,
    viability: row.viability,
    last_imported: new Date().toISOString(),
  }));

  // Supabase upsert supports batches
  const { error } = await supabase
    .from('meta_usage_cache')
    .upsert(records, { onConflict: 'format,pokemon_name' });

  if (error) throw error;
}

export async function clearFormatUsage(format: string): Promise<void> {
  const { error } = await supabase
    .from('meta_usage_cache')
    .delete()
    .eq('format', format);

  if (error) throw error;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert meta_usage_cache percentage to a 0–1 fraction.
 * Smogon imports always store 0–100 (including sub-1% values like 0.5).
 * Do not pass already-normalized fractions through this helper.
 */
export function metaUsageFraction(value: number): number {
  return value / 100;
}

function toMetaUsageRow(row: Tables<'meta_usage_cache'>): MetaUsageRow {
  return {
    id: row.id,
    format: row.format,
    pokemon_name: row.pokemon_name,
    usage_pct: metaUsageFraction(Number(row.usage_pct)),
    lead_pct: row.lead_pct != null ? metaUsageFraction(Number(row.lead_pct)) : null,
    moves: (row.moves as Record<string, number>) ?? {},
    items: (row.items as Record<string, number>) ?? {},
    abilities: (row.abilities as Record<string, number>) ?? {},
    teammates: (row.teammates as Record<string, number>) ?? {},
    spreads: (row.spreads as Record<string, number>) ?? {},
    tera_types: (row.tera_types as Record<string, number>) ?? null,
    counters: (row.counters as Record<string, [number, number, number]>) ?? null,
    viability: (row.viability as number[]) ?? null,
    last_imported: row.last_imported,
  };
}
