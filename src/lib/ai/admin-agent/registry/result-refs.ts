/**
 * The ids a conversation has seen (plan 6.3, provenance): the typed `id()` fields of an R or P tool's result.
 *
 * A write that names an id (a roster player, a ruleset version, a league) is staged only when the conversation has seen
 * that id, so an id the model invented or lifted from poisoned text answers `unknown_reference`. The loop records what a
 * read returned with `store.refs.recordRefs`; this module finds it. The tool's strict output schema is the source of
 * truth: only a field declared with `id()` (marked `idRef` in the JSON schema) counts, never a `code()` token or a text
 * field that happens to look like a uuid.
 *
 * Pure: it reads the schema and the data and writes nothing.
 */
import { z } from 'zod';
import type { RunnableTool } from './define';

type Schema = Record<string, unknown>;

export interface ResultRef {
  /** `season` for `season_id`; for a bare `id` the property that holds it (`player` for `players.items[].id`), else the tool's subject. */
  kind: string;
  id: string;
  /** The fenced `label` next to the id, if the object has one. */
  label: string | null;
}

/** The most refs one result yields: a bound, not an expectation (a roster page lists at most 128 players). */
export const RESULT_REFS_MAX = 400;
const MAX_DEPTH = 12;
const KIND_MAX = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schemas = new WeakMap<object, Schema>();

function outputSchemaOf(tool: RunnableTool): Schema {
  let schema = schemas.get(tool);
  if (schema === undefined) {
    schema = z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'any', reused: 'inline', cycles: 'ref' }) as Schema;
    schemas.set(tool, schema);
  }
  return schema;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `players` becomes `player`; a name that ends in `ss` or `s` alone is left as it is. */
const singular = (name: string): string => (name.length > 3 && name.endsWith('s') && !name.endsWith('ss') ? name.slice(0, -1) : name);

/**
 * What an id is an id OF: a `season_id` is a season; a bare `id` belongs to the object it sits in, named by the nearest
 * property above it (`players` -> `player`), else by the tool's subject (`league_get` -> `league`).
 */
function kindOf(trail: readonly string[], subject: string): string {
  const key = trail[trail.length - 1] ?? '';
  if (key !== 'id') return (key.replace(/(^|_)ids?$/, '') || subject).slice(0, KIND_MAX);
  const holder = [...trail.slice(0, -1)].reverse().find((name) => name !== 'items' && name !== 'data');
  return singular(holder ?? subject).slice(0, KIND_MAX);
}

/** The `id()` fields of `data`, which `tool.output` already accepted. */
export function extractResultRefs(tool: Pick<RunnableTool, 'name' | 'output'>, data: unknown): ResultRef[] {
  const subject = tool.name.split('_')[0] || 'id';
  const found = new Map<string, ResultRef>();
  const add = (trail: readonly string[], id: unknown, label: unknown): void => {
    if (typeof id !== 'string' || !UUID.test(id) || found.size >= RESULT_REFS_MAX) return;
    const lower = id.toLowerCase();
    // The sibling `label` names the object's own `id`, not its other references.
    const named = trail[trail.length - 1] === 'id' && typeof label === 'string' && label !== '' ? label : null;
    if (!found.has(lower)) found.set(lower, { kind: kindOf(trail, subject), id: lower, label: named });
  };

  const walk = (node: Schema, value: unknown, trail: readonly string[], label: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || value === null || value === undefined || found.size >= RESULT_REFS_MAX) return;
    if (Array.isArray(node.anyOf)) {
      for (const branch of node.anyOf as Schema[]) walk(branch, value, trail, label, depth + 1);
      return;
    }
    if (node.type === 'string') {
      if (node.idRef === true) add(trail, value, label);
      return;
    }
    if (node.type === 'array' && Array.isArray(value)) {
      for (const item of value) walk(node.items as Schema, item, trail, null, depth + 1);
      return;
    }
    if (node.type === 'object' && isRecord(value)) {
      const siblingLabel = value.label;
      for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Schema>)) {
        walk(child, value[name], [...trail, name], siblingLabel, depth + 1);
      }
    }
  };

  walk(outputSchemaOf(tool as RunnableTool), data, [], null, 0);
  return [...found.values()];
}
