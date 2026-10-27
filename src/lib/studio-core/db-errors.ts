/**
 * Reading a PostgREST error the same way for every studio. A studio's `map*DbError` matches the SQLSTATE, the P0001
 * message (the signal word its functions raise) or the constraint name, never text a user typed, and returns anything it
 * does not know unchanged.
 *
 * Pure: no Supabase, no `next/*`, no `server-only`.
 */

export interface DbSignal {
  /** SQLSTATE (`P0001`, `23505`, ...). */
  code: string | undefined;
  /** The exception message of a `RAISE EXCEPTION`, or the constraint violation text. */
  message: string | undefined;
  /** The parsed DETAIL json of `RAISE EXCEPTION ... USING DETAIL = <json text>`, else an empty object. */
  detail: Readonly<Record<string, unknown>>;
  /** The name in `... violates check constraint "<name>"`, or null. */
  constraint: string | null;
}

/** The DETAIL json of a `RAISE EXCEPTION ... USING DETAIL = <json text>`, or an empty object. */
function detailOf(details: unknown): Record<string, unknown> {
  if (typeof details !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The fields of a PostgREST error the mappers read, or `null` for anything that is not an object. */
export function parseDbError(error: unknown): DbSignal | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = typeof e.message === 'string' ? e.message : undefined;
  const match = message === undefined ? null : /constraint "([^"]+)"/.exec(message);
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    message,
    detail: detailOf(e.details),
    constraint: match ? match[1] : null,
  };
}

/** A finite number from a DETAIL member, else `fallback`. */
export function detailNumber(signal: DbSignal, key: string, fallback: number): number {
  const value = signal.detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
