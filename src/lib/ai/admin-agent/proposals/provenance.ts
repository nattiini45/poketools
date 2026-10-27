/**
 * Provenance of write arguments (plan 4.5): every uuid in a staged call must be one the conversation has legitimately seen,
 * recorded in `admin_agent_refs` (a uuid the admin typed, a structured id field of a typed tool result, a proposal step
 * result), or be a symbolic `$ref`. An id the model invented, or one lifted from poisoned text, answers `unknown_reference`.
 *
 * Only string values that are entirely a uuid count: a uuid mentioned inside prose is not an id any route would read.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NODES = 5_000;
const MAX_DEPTH = 12;

/** Every uuid-valued string leaf of `value`, lower-cased and de-duplicated. `{ "$ref": ... }` objects are skipped. */
export function collectUuids(value: unknown): string[] {
  const found = new Set<string>();
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (typeof node === 'string') {
      if (UUID.test(node)) found.add(node.toLowerCase());
    } else if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
    } else if (typeof node === 'object' && node !== null) {
      if (typeof (node as { $ref?: unknown }).$ref === 'string') return;
      for (const item of Object.values(node)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return [...found];
}

/**
 * The ids of `ids` the conversation has not seen. `exempt` holds ids that need no record (the entities this very Plan
 * already built: their ids were written by trusted code, never by the model).
 */
export async function unknownReferences(
  ids: readonly string[],
  exempt: ReadonlySet<string>,
  knownIds: (ids: string[]) => Promise<Set<string>>,
): Promise<string[]> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => !exempt.has(id));
  if (wanted.length === 0) return [];
  const known = await knownIds(wanted);
  return wanted.filter((id) => !known.has(id));
}
