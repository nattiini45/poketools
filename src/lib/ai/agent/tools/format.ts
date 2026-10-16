/**
 * Shared helpers for parsing Showdown-style format strings in agent tools.
 */

/**
 * Extract the generation number from a format string like "gen9ou" or
 * "gen8uu" → 8. Only the leading `gen<N>` is read, so suffixes that contain
 * digits (e.g. "gen9vgc2025" → 9, NOT 92025) do not bleed into the number.
 * Falls back to 9 when absent/unparseable and clamps to the valid 1..9 range.
 */
export function parseGenFromFormat(format: string | undefined | null): number {
  const match = format?.match(/^gen(\d+)/i);
  if (!match) return 9;
  const gen = Number(match[1]);
  if (!Number.isFinite(gen)) return 9;
  return Math.min(9, Math.max(1, gen));
}
