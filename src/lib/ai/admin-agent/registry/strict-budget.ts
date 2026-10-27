/**
 * Which tools of a set are sent with `strict: true` (spike S4).
 *
 * The Messages API caps strict tools per request: at most 20 tools, at most 24 optional parameters and at most 16
 * union-typed parameters (type arrays or `anyOf` / `oneOf`) summed over all strict schemas, and it refuses a compiled
 * grammar it finds too large; any excess is a 400 for the whole request. The grammar limit is not published: S4 found
 * it tracks the enum values and the schema size, so two calibrated budgets stand in for it (sets with at most 280 enum
 * characters and 5,858 schema bytes passed, sets from 399 enum characters failed; the budgets sit below the passing
 * points). The eval harness sends real sets, so a change that trips the limit fails there. A set offers more tools than that, so strictness is a budget: tools are taken greedily in priority
 * order (stage-only D/B/G tools first, then P, then R; by name within a class) while the totals stay within the limits.
 * Every tool, strict or not, is validated server-side against its full zod schema, so a non-strict tool loses only the
 * decoding guarantee, never validation.
 *
 * Pure and deterministic: the same offered list always gives the same strict flags, so the wire bytes (and the cache
 * prefix and `registryVersion`) stay stable per role and phase.
 */
import type { JsonValue } from './wire-schema';
import type { ToolClass } from './types';

export const STRICT_LIMITS = { tools: 20, optional: 24, unions: 16, enumChars: 250, bytes: 5000 } as const;

export interface SchemaCost {
  optional: number;
  unions: number;
  /** Characters of every enum value (the grammar-size proxy). */
  enumChars: number;
  /** Bytes of the compact JSON schema. */
  bytes: number;
}

type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Optional and union-typed parameters of one input schema, counted at every depth the way the API counts them. */
export function schemaCost(schema: JsonValue): SchemaCost {
  const cost: SchemaCost = { optional: 0, unions: 0, enumChars: 0, bytes: JSON.stringify(schema).length };
  const walk = (node: JsonValue | undefined): void => {
    if (!isObject(node)) return;
    if (Array.isArray(node.type) || 'anyOf' in node || 'oneOf' in node) cost.unions += 1;
    if (Array.isArray(node.enum)) for (const value of node.enum) cost.enumChars += String(value).length;
    if (isObject(node.properties)) {
      const required = new Set(Array.isArray(node.required) ? node.required.filter((k): k is string => typeof k === 'string') : []);
      for (const [key, child] of Object.entries(node.properties)) {
        if (!required.has(key)) cost.optional += 1;
        walk(child);
      }
    }
    walk(node.items);
    for (const key of ['anyOf', 'oneOf'] as const) {
      const branches = node[key];
      if (Array.isArray(branches)) branches.forEach(walk);
    }
  };
  walk(schema);
  return cost;
}

const CLASS_RANK: Record<ToolClass, number> = { D: 0, B: 0, G: 0, P: 1, R: 2 };

export interface StrictCandidate {
  readonly name: string;
  readonly class: ToolClass;
  readonly inputSchema: JsonValue;
}

/** The names of the tools sent strict, chosen greedily within `STRICT_LIMITS`. */
export function chooseStrictTools(candidates: readonly StrictCandidate[]): ReadonlySet<string> {
  const ordered = [...candidates].sort((a, b) => CLASS_RANK[a.class] - CLASS_RANK[b.class] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const chosen = new Set<string>();
  const used: SchemaCost = { optional: 0, unions: 0, enumChars: 0, bytes: 0 };
  for (const candidate of ordered) {
    if (chosen.size >= STRICT_LIMITS.tools) break;
    const cost = schemaCost(candidate.inputSchema);
    const over = (['optional', 'unions', 'enumChars', 'bytes'] as const).some((key) => used[key] + cost[key] > STRICT_LIMITS[key]);
    if (over) continue;
    chosen.add(candidate.name);
    for (const key of ['optional', 'unions', 'enumChars', 'bytes'] as const) used[key] += cost[key];
  }
  return chosen;
}
