const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a valid UUID. Non-throwing twin of `assertValidUuid`. */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Throws if `value` is not a valid UUID. Use before interpolating IDs into Supabase `.or()` filters. */
export function assertValidUuid(value: string, label = 'ID'): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected UUID format`);
  }
}
