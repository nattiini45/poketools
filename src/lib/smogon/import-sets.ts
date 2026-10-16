/**
 * Import pipeline: fetches sample sets and analyses from data.pkmn.cc
 * and upserts into the smogon_sample_sets table.
 *
 * Fetches per-generation files:
 *   /sets/genN.json   — movesets with slash options
 *   /analyses/genN.json — strategy writeups and descriptions
 */

import type { SetImportResult } from '@/types/sample-sets';
import type { SmogonMoveset } from '@/types/sample-sets';
import { upsertSampleSetBatch } from '@/lib/supabase/queries/sample-sets';

const SETS_BASE = 'https://pkmn.github.io/smogon/data/sets';
const ANALYSES_BASE = 'https://pkmn.github.io/smogon/data/analyses';

// Shape of /sets/genN.json
interface SetsFile {
  [pokemonName: string]: {
    [formatName: string]: {
      [setName: string]: RawMoveset;
    };
  };
}

interface RawMoveset {
  moves: (string | string[])[];
  ability: string | string[];
  item?: string | string[];
  nature?: string | string[];
  evs?: Partial<Record<string, number>> | Partial<Record<string, number>>[];
  ivs?: Partial<Record<string, number>> | Partial<Record<string, number>>[];
  teratypes?: string[];
  level?: number | number[];
}

// Shape of /analyses/genN.json
interface AnalysesFile {
  [pokemonName: string]: {
    [formatName: string]: {
      overview?: string;
      comments?: string;
      outdated?: boolean;
      sets: {
        [setName: string]: {
          description?: string;
          outdated?: boolean;
        };
      };
      credits?: unknown;
    };
  };
}

/**
 * Strip HTML tags to plain text for descriptions.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize EV/IV objects which may be arrays (multiple spreads) into a single spread.
 * Takes the first spread if an array is provided.
 */
function normalizeSpread(
  spread: Partial<Record<string, number>> | Partial<Record<string, number>>[] | undefined
): Partial<Record<string, number>> | undefined {
  if (!spread) return undefined;
  if (Array.isArray(spread)) return spread[0];
  return spread;
}

/**
 * Normalize level which may be a number or array.
 */
function normalizeLevel(level: number | number[] | undefined): number | undefined {
  if (level === undefined) return undefined;
  if (Array.isArray(level)) return level[0];
  return level;
}

function toSmogonMoveset(raw: RawMoveset): SmogonMoveset {
  return {
    moves: raw.moves,
    ability: raw.ability,
    item: raw.item ?? '',
    nature: raw.nature ?? 'Hardy',
    evs: normalizeSpread(raw.evs) as Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>> | undefined,
    ivs: normalizeSpread(raw.ivs) as Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>> | undefined,
    teratypes: raw.teratypes,
    level: normalizeLevel(raw.level),
  };
}

export async function importGenerationSets(gen: number): Promise<SetImportResult> {
  try {
    // Fetch sets and analyses in parallel
    const [setsRes, analysesRes] = await Promise.all([
      fetch(`${SETS_BASE}/gen${gen}.json`),
      fetch(`${ANALYSES_BASE}/gen${gen}.json`),
    ]);

    if (!setsRes.ok) {
      if (setsRes.status === 404) {
        return { generation: gen, setsCount: 0, analysesCount: 0, status: 'skipped', error: 'Not found' };
      }
      throw new Error(`Sets fetch failed: ${setsRes.status}`);
    }

    const setsData: SetsFile = await setsRes.json();
    const analysesData: AnalysesFile = analysesRes.ok ? await analysesRes.json() : {};

    const rows: Parameters<typeof upsertSampleSetBatch>[0] = [];
    let analysesCount = 0;

    for (const [pokemonName, formats] of Object.entries(setsData)) {
      for (const [formatName, sets] of Object.entries(formats)) {
        const formatLower = formatName.toLowerCase();

        // Get matching analysis data
        const analysis = analysesData[pokemonName]?.[formatName];
        const analysisOutdated = analysis?.outdated ?? false;

        for (const [setName, rawMoveset] of Object.entries(sets)) {
          // Get description from analyses
          const setAnalysis = analysis?.sets?.[setName];
          let description: string | null = null;

          if (setAnalysis?.description) {
            description = stripHtml(setAnalysis.description);
            analysesCount++;
          }

          const outdated = setAnalysis?.outdated ?? analysisOutdated;

          rows.push({
            generation: gen,
            format: formatLower,
            pokemon_name: pokemonName,
            set_name: setName,
            moveset: toSmogonMoveset(rawMoveset),
            description,
            outdated,
          });
        }
      }
    }

    // Batch upsert in chunks
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await upsertSampleSetBatch(rows.slice(i, i + CHUNK_SIZE));
    }

    return { generation: gen, setsCount: rows.length, analysesCount, status: 'success' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { generation: gen, setsCount: 0, analysesCount: 0, status: 'error', error: message };
  }
}

export async function importAllSets(
  generations?: number[]
): Promise<SetImportResult[]> {
  const gens = generations ?? [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const results: SetImportResult[] = [];

  for (const gen of gens) {
    const result = await importGenerationSets(gen);
    results.push(result);

    // Small delay between requests
    if (result.status === 'success') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
