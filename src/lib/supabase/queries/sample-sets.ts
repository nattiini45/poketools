import { supabase } from '../client';
import type { Json, Tables } from '@/types/database';
import type { SampleSetRow, SmogonMoveset } from '@/types/sample-sets';

function escapeIlikePattern(input: string): string {
  return input.replace(/[%_()\\]/g, '\\$&');
}

// ── Read ────────────────────────────────────────────────────────────

export async function getSampleSets(
  pokemonName: string,
  options?: {
    generation?: number;
    format?: string;
    includeOutdated?: boolean;
  }
): Promise<SampleSetRow[]> {
  let query = supabase
    .from('smogon_sample_sets')
    .select('*')
    .eq('pokemon_name', pokemonName);

  if (options?.generation) {
    query = query.eq('generation', options.generation);
  }

  if (options?.format) {
    query = query.eq('format', options.format);
  }

  if (!options?.includeOutdated) {
    query = query.eq('outdated', false);
  }

  // Sort: non-outdated first, then by format, then set name
  query = query
    .order('outdated', { ascending: true })
    .order('format')
    .order('set_name');

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(toSampleSetRow);
}

export async function getSampleSetsByFormat(
  format: string,
  generation: number
): Promise<Record<string, SampleSetRow[]>> {
  const { data, error } = await supabase
    .from('smogon_sample_sets')
    .select('*')
    .eq('generation', generation)
    .eq('format', format)
    .order('pokemon_name')
    .order('set_name');

  if (error) throw error;

  const grouped: Record<string, SampleSetRow[]> = {};
  for (const row of (data ?? []).map(toSampleSetRow)) {
    if (!grouped[row.pokemon_name]) grouped[row.pokemon_name] = [];
    grouped[row.pokemon_name].push(row);
  }
  return grouped;
}

export async function searchSampleSets(
  query: string,
  generation?: number
): Promise<SampleSetRow[]> {
  let q = supabase
    .from('smogon_sample_sets')
    .select('*')
    .or(`pokemon_name.ilike.%${escapeIlikePattern(query)}%,set_name.ilike.%${escapeIlikePattern(query)}%`);

  if (generation) {
    q = q.eq('generation', generation);
  }

  q = q.limit(20);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map(toSampleSetRow);
}

// ── Write ───────────────────────────────────────────────────────────

export async function upsertSampleSet(row: {
  generation: number;
  format: string;
  pokemon_name: string;
  set_name: string;
  moveset: SmogonMoveset;
  description: string | null;
  outdated: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from('smogon_sample_sets')
    .upsert(
      {
        generation: row.generation,
        format: row.format,
        pokemon_name: row.pokemon_name,
        set_name: row.set_name,
        moveset: row.moveset as unknown as Json,
        description: row.description,
        outdated: row.outdated ?? false,
        last_imported: new Date().toISOString(),
      },
      { onConflict: 'generation,format,pokemon_name,set_name' }
    );

  if (error) throw error;
}

export async function upsertSampleSetBatch(
  rows: Parameters<typeof upsertSampleSet>[0][]
): Promise<void> {
  if (rows.length === 0) return;

  const records = rows.map((row) => ({
    generation: row.generation,
    format: row.format,
    pokemon_name: row.pokemon_name,
    set_name: row.set_name,
    moveset: row.moveset as unknown as Json,
    description: row.description,
    outdated: row.outdated ?? false,
    last_imported: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('smogon_sample_sets')
    .upsert(records, { onConflict: 'generation,format,pokemon_name,set_name' });

  if (error) throw error;
}

export async function clearGenerationSets(generation: number): Promise<void> {
  const { error } = await supabase
    .from('smogon_sample_sets')
    .delete()
    .eq('generation', generation);

  if (error) throw error;
}

// ── Helpers ─────────────────────────────────────────────────────────

function toSampleSetRow(row: Tables<'smogon_sample_sets'>): SampleSetRow {
  return {
    id: row.id,
    generation: row.generation,
    format: row.format,
    pokemon_name: row.pokemon_name,
    set_name: row.set_name,
    moveset: row.moveset as unknown as SmogonMoveset,
    description: row.description,
    outdated: row.outdated ?? false,
    last_imported: row.last_imported,
  };
}
