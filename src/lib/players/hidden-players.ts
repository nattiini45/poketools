/** A ranking without the rows of players the public directory hides. Applied after a cached read, never inside it. */
export function withoutHiddenPlayers<T extends { player_id: string }>(rows: T[], hiddenIds: readonly string[]): T[] {
  if (hiddenIds.length === 0) return rows;
  const hidden = new Set(hiddenIds);
  return rows.filter((row) => !hidden.has(row.player_id));
}

/** The same drop for participant-shaped rows, which key the player as `id`. */
export function withoutHiddenIds<T extends { id: string }>(rows: readonly T[], hiddenIds: readonly string[]): T[] {
  if (hiddenIds.length === 0) return [...rows];
  const hidden = new Set(hiddenIds);
  return rows.filter((row) => !hidden.has(row.id));
}
