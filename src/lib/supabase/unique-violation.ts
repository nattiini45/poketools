/** A Postgres unique violation of exactly `constraint` (others are not ours to map). */
export function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  if (code !== '23505') return false;
  return (
    (typeof message === 'string' && message.includes(constraint)) ||
    (typeof details === 'string' && details.includes(constraint))
  );
}
