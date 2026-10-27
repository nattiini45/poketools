/**
 * The one reader of the generation in a Showdown-style format string, shared
 * by the AI prompt builders and the agent tools.
 */
import { generationOrDefault } from '@/lib/pkmn/format-id';

/**
 * Extract the generation number from a format string like "gen9ou" or
 * "gen8uu" → 8. Only the leading `gen<N>` is read, so suffixes that contain
 * digits (e.g. "gen9vgc2025" → 9, NOT 92025) do not bleed into the number.
 * Case-insensitive, because the text may be model-supplied. Falls back to 9
 * when absent or no format id (a generation outside 1..9 is none).
 */
export function parseGenFromFormat(format: string | undefined | null): number {
  return generationOrDefault(format?.toLowerCase());
}
