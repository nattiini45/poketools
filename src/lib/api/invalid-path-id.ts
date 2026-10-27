import { NextResponse } from 'next/server';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ApiResult } from '@/types/api';
import { isValidUuid } from '@/lib/utils/uuid';

/** The catalogued `INVALID_<NOUN>_ID` codes (one per resource kind). */
export type InvalidPathIdCode = Extract<ApiErrorCode, `INVALID_${string}_ID`>;

/** English message per code (log line and client fallback), the same text as the catalogue's `en`. */
const INVALID_PATH_ID_MESSAGES: Record<InvalidPathIdCode, string> = {
  INVALID_MATCH_ID: 'Match not found',
  INVALID_PLAYER_ID: 'Player not found',
  INVALID_ROUND_ID: 'Round not found',
  INVALID_SEASON_ID: 'League not found',
  INVALID_PHASE_ID: 'Phase not found',
  INVALID_GROUP_ID: 'Group not found',
  INVALID_LEAGUE_TRASH_ID: 'Trashed league not found',
  INVALID_TOURNAMENT_ID: 'Tournament not found',
  INVALID_RULESET_ID: 'Ruleset not found',
  INVALID_TEAM_ID: 'Team not found',
  INVALID_SESSION_ID: 'Session not found',
  INVALID_STORYLINE_ID: 'Storyline not found',
  INVALID_POINT_BUY_LIST_ID: 'Point-buy list not found',
  INVALID_PRESET_ID: 'Preset not found',
  INVALID_WEBHOOK_ID: 'Webhook not found',
  INVALID_INTEGRATION_ID: 'Integration not found',
  INVALID_EVOLUTION_TIER_ID: 'Evolution tier not found',
  INVALID_POOL_ENTRY_ID: 'Pool entry not found',
  INVALID_POOL_TEMPLATE_ID: 'Template not found',
  INVALID_PICK_ID: 'Pick not found',
  INVALID_REDRAFT_SLOT_ID: 'Redraft slot not found',
  INVALID_GAME_ID: 'Game not found',
  INVALID_PROPOSAL_ID: 'Proposal not found',
  INVALID_GALLERY_ITEM_ID: 'Gallery item not found',
  INVALID_ACHIEVEMENT_ID: 'Achievement not found',
  INVALID_NOTE_ID: 'Note not found',
  INVALID_WIKI_REPORT_ID: 'Report not found',
};

/**
 * Guard for a dynamic path segment that must be a UUID (repo convention, code
 * review M6): a malformed id names no row, so the answer is 404 with the
 * resource's `INVALID_<NOUN>_ID` code, given before any query. Without it,
 * Postgres rejects the non-UUID filter and the route answers 500.
 *
 * Returns the 404 response for a malformed id, `null` for a valid one:
 *   const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
 *   if (invalid) return invalid;
 */
export function rejectInvalidPathId(
  value: string,
  code: InvalidPathIdCode
): NextResponse<ApiResult<never>> | null {
  if (isValidUuid(value)) return null;
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: INVALID_PATH_ID_MESSAGES[code], code },
    { status: 404 }
  );
}
