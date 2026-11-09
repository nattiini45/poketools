/**
 * The later bracket matches an admin game change would reset (`GameChangeDownstreamPlayedError`, 409
 * `game_change_downstream_played`). Pure and client-safe: the pipeline encodes the list into the error's `params`
 * (API error params are strings and numbers only), the admin UI decodes it to show the approval prompt.
 */
import type { MatchResetPreviewMatch } from '@/lib/admin/match-detail';
import type { MatchStatus } from '@/types/match';

/** One played later bracket match: enough to name it in a prompt (round, both players, state). */
export type DownstreamMatchSummary = MatchResetPreviewMatch;

/** The `matches` param of the refusal: a JSON array, so a player or round name can hold any character. */
export function encodeDownstreamMatches(matches: readonly DownstreamMatchSummary[]): string {
  return JSON.stringify(
    matches.map((match) => ({
      id: match.id,
      round_name: match.round_name,
      player_1_name: match.player_1_name,
      player_2_name: match.player_2_name,
      status: match.status,
    })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The matches a refusal lists. Anything that is not the encoded list (a missing or malformed param) reads as an empty
 * list: the prompt then states the count only, never a wrong match.
 */
export function parseDownstreamMatches(raw: unknown): DownstreamMatchSummary[] {
  if (typeof raw !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DownstreamMatchSummary[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const { id, round_name, player_1_name, player_2_name, status } = item;
    if (
      typeof id !== 'string' ||
      typeof round_name !== 'string' ||
      typeof player_1_name !== 'string' ||
      typeof player_2_name !== 'string' ||
      typeof status !== 'string'
    ) {
      continue;
    }
    out.push({ id, round_name, player_1_name, player_2_name, status: status as MatchStatus });
  }
  return out;
}
