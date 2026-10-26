/**
 * Defensive readers for untyped JSON that the league trash code parses on both sides of the wire: the RPC results in
 * the server-only queries and the route bodies in the client requests.
 *
 * Pure and client-safe: no reads, no `server-only`.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The string items of an array; anything else reads empty. */
export function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
