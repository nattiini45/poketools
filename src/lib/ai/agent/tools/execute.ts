/**
 * Tool dispatch + caching for the agent registry (PRD §5).
 *
 * `executeTool(name, rawInput)`:
 *   1. looks up the tool in `AGENT_TOOLS` (unknown name → `{ ok: false }`),
 *   2. validates `rawInput` with the tool's Zod schema (never throws — invalid
 *      input returns `{ ok: false, error }`),
 *   3. runs the executor under a 15s timeout,
 *   4. wraps the result as `{ ok: true, data }`.
 *
 * Deterministic read tools are memoised for 5 minutes (keyed by name + input).
 * `buildTeam` and `createPokepaste` are never cached — they have side effects
 * (pokepaste publishing) or are too coarse to share.
 */
import { LruCache } from '@/lib/utils/lru-cache';
import { formatZodErrors } from '@/lib/validation/schemas';
import { AGENT_TOOLS } from './registry';

const RESULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 15_000;
const CACHE_MAX_ENTRIES = 200;

/**
 * Per-tool wall-clock budget. Single-shot read tools settle in well under the
 * 15s default; `buildTeam` deterministically chains many of them (per-mon
 * lookups + usage + coverage + repeated validation + a pokepaste publish), so
 * it gets a wider 60s budget — 15s killed it mid-assembly.
 */
const TIMEOUT_BY_TOOL: Record<string, number> = {
  buildTeam: 60_000,
  // Fetches + parses every game's replay for the match — well over 15s on a Bo5.
  getMatchAnalysisContext: 60_000,
};
function timeoutFor(name: string): number {
  return TIMEOUT_BY_TOOL[name] ?? DEFAULT_TIMEOUT_MS;
}

/** Tools whose results must not be cached (side effects / non-idempotent). */
const NO_CACHE = new Set(['buildTeam', 'createPokepaste']);

export type ExecuteToolResult =
  | { ok: true; data: unknown; cached?: boolean }
  | { ok: false; error: string };

// ─── 5-minute in-memory result cache ─────────────────────────────────

const cache = new LruCache({ ttlMs: RESULT_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

/** Clear the result cache. Intended for unit tests only. */
export function __clearToolResultCache(): void {
  cache.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Stable JSON (sorted keys) so equal inputs share a cache key. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

function withTimeout<T>(value: T | Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${ms}ms`)), ms);
  });
  return Promise.race([
    Promise.resolve(value).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

// ─── executeTool ─────────────────────────────────────────────────────

export async function executeTool(name: string, rawInput: unknown): Promise<ExecuteToolResult> {
  const tool = AGENT_TOOLS[name];
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: `Invalid input for '${name}': ${formatZodErrors(parsed.error)}` };
  }

  const cacheable = !NO_CACHE.has(name);
  const key = cacheable ? `${name}:${stableStringify(parsed.data)}` : '';
  if (cacheable) {
    // getEntry keeps a cached `undefined` result distinguishable from a miss.
    const entry = cache.getEntry<unknown>(key);
    if (entry) return { ok: true, data: entry.value, cached: true };
  }

  try {
    const data = await withTimeout(tool.execute(parsed.data), timeoutFor(name), name);
    if (cacheable) cache.set(key, data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `Tool '${name}' failed` };
  }
}
