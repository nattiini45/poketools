/**
 * Reads that only add to a page (history, dispute details, proposals) must not
 * take it down: a failure is logged and the page renders with the fallback,
 * keeping its controls. Server-only (logs the error).
 */
export interface OptionalRead<T> {
  value: T;
  failed: boolean;
}

export async function readOptional<T>(label: string, read: Promise<T>, fallback: T): Promise<OptionalRead<T>> {
  try {
    return { value: await read, failed: false };
  } catch (error) {
    console.error(`[admin-match] Failed to read ${label}:`, error);
    return { value: fallback, failed: true };
  }
}
