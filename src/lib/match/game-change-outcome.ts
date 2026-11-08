/**
 * How the admin game UI (the edit page, the inline editor on the match page,
 * per-game delete and match reset in `AdminMatchActions`) reads the responses of `PATCH`/`DELETE
 * /api/admin/games/[id]` and `POST /api/admin/matches/[id]/reset`. Pure, so
 * the decisions are unit-tested without a DOM.
 *
 * The UI renders every message through the error catalogues by code; this
 * module only decides WHICH codes to show and which recovery to offer.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { parseDownstreamMatches, type DownstreamMatchSummary } from '@/lib/match/downstream-matches';
import { parseStageEndedWarning, stageEndedWarningToApi } from '@/lib/match/stage-ended-warning';

/**
 * Failure codes after which the page shows data that is no longer current,
 * so the only sensible next step is a reload:
 *   - `admin_game_edit_stale`: the game moved past the version the editor loaded (nothing saved);
 *   - `admin_game_edit_in_progress`: another edit of the game was running (nothing saved; the running edit changes the game);
 *   - `admin_game_changed_concurrently`: a concurrent edit or delete won the rollback race (nothing changed);
 *   - `admin_game_delete_recounted`: a concurrent edit counted the game again, so it was not deleted;
 *   - `admin_game_match_status_conflict`: the change IS saved, the match status moved concurrently;
 *   - `game_not_found`: the game was deleted meanwhile;
 *   - `admin_match_reset_partial`: a reset stopped part-way (some games removed, the match not reset);
 *   - `match_state_changed`: a complete or dispute found the match already in another state (nothing saved).
 */
const RELOAD_CODES: ReadonlySet<string> = new Set([
  'admin_game_edit_stale',
  'admin_game_edit_in_progress',
  'admin_game_changed_concurrently',
  'admin_game_delete_recounted',
  'admin_game_match_status_conflict',
  'game_not_found',
  // a match reset stopped part-way (some games removed, match fields not reset); resetting again finishes it
  'admin_match_reset_partial',
  'match_state_changed',
]);

/** Failure codes whose recovery is a tool on the admin data page (`/admin/data`). */
const DATA_TOOLS_CODES: ReadonlySet<string> = new Set(['admin_game_left_uncounted']);

/** The recovery the UI offers next to a failed game change. */
export interface GameChangeFailureHints {
  /** Show a "reload page" action: the page's data is stale. */
  reload: boolean;
  /** Link the admin data tools (aggregate rebuild, record reconciliation). */
  dataTools: boolean;
}

export function gameChangeFailureHints(error: ApiErrorLike | null | undefined): GameChangeFailureHints {
  const code = error?.code ?? '';
  return { reload: RELOAD_CODES.has(code), dataTools: DATA_TOOLS_CODES.has(code) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Warnings a SUCCESSFUL game change carries in its `data` (the change is
 * saved; something after it needs the admin's attention), as catalogue codes:
 *   - `evolution_recheck_failed: true` → `admin_game_evolution_recheck_failed`
 *     (run Repair in Record Reconciliation).
 *   - `format_revert_failed: true` → `admin_game_format_revert_failed`
 *     (the league's format effects of the old result were not taken back).
 *   - `stage_already_ended` → `admin_game_stage_already_ended` (or `_nobody` /
 *     `_unlisted`): the result taken back belonged to a format phase whose
 *     stage had already ended; the warning names the players who advanced.
 * Unknown or malformed fields are ignored: `data` comes from our own API, and
 * a missing flag means "nothing to warn about".
 */
export function gameChangeWarnings(data: unknown): ApiErrorLike[] {
  if (!isRecord(data)) return [];
  const warnings: ApiErrorLike[] = [];
  if (data.evolution_recheck_failed === true) {
    warnings.push({ code: 'admin_game_evolution_recheck_failed' });
  }
  if (data.format_revert_failed === true) {
    warnings.push({ code: 'admin_game_format_revert_failed' });
  }
  const stageEnded = parseStageEndedWarning(data.stage_already_ended);
  if (stageEnded) warnings.push(stageEndedWarningToApi(stageEnded));
  return warnings;
}

/** Warning codes whose recovery is a tool on the admin data page (the others need no tool, only the admin's attention). */
const DATA_TOOLS_WARNING_CODES: ReadonlySet<string> = new Set([
  'admin_game_evolution_recheck_failed',
  'admin_game_format_revert_failed',
]);

/** Whether a warning of a saved change points the admin to the data tools (`GameChangeAlerts`). */
export function warningNeedsDataTools(warning: ApiErrorLike): boolean {
  return DATA_TOOLS_WARNING_CODES.has(warning.code ?? '');
}

/** The played later bracket matches an admin game change would reset, as the approval prompt shows them. */
export interface DownstreamApproval {
  /** How many later matches the API counted (the list below can be shorter if it could not be read). */
  count: number;
  matches: DownstreamMatchSummary[];
}

/**
 * The approval an admin game edit or delete needs, when the API refused it for that reason (409
 * `game_change_downstream_played`, nothing written); null for any other outcome. The UI asks the admin to approve and
 * sends the request again with the confirm flag (`gameEditRequest`, `gameDeleteRequest`).
 */
export function downstreamApproval(error: ApiErrorLike | null | undefined): DownstreamApproval | null {
  if (error?.code !== 'game_change_downstream_played') return null;
  const matches = parseDownstreamMatches(error.params?.matches);
  const count = error.params?.count;
  return { count: typeof count === 'number' && Number.isFinite(count) ? count : matches.length, matches };
}

/** The later matches an approval covers: what the resend names, so a match played since the prompt is not reset unseen. */
export function approvedMatchIds(approval: DownstreamApproval): string[] {
  return approval.matches.map((match) => match.id);
}

/** One battle_stats row of an admin game edit, as `adminGameEditSchema` takes it. */
export interface GameEditStatInput {
  player_id: string;
  pokemon_name: string;
  kos_dealt: number;
  was_koed: boolean;
  was_lead: boolean;
  was_brought: boolean;
  moves_used: string[];
  turns_active: number;
}

/** What an admin game edit sends (`PATCH /api/admin/games/[id]`). */
export interface GameEditPayload {
  winnerId: string;
  battleStats: GameEditStatInput[];
  /**
   * The game's `updated_at` as the editor loaded it (optimistic concurrency).
   * Omitted when the editor has none; the server then checks against the
   * version it reads first.
   */
  expectedUpdatedAt?: string;
  /**
   * The admin approved resetting the played later bracket matches the edit affects (after the API refused the first
   * request with 409 `game_change_downstream_played`).
   */
  confirmDownstream?: readonly string[];
}

/** The request of an admin game edit: the one place both editors build it. */
export function gameEditRequest(gameId: string, payload: GameEditPayload): { url: string; init: RequestInit } {
  return {
    url: `/api/admin/games/${gameId}`,
    init: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        winner_id: payload.winnerId,
        battle_stats: payload.battleStats,
        ...(payload.expectedUpdatedAt ? { expected_updated_at: payload.expectedUpdatedAt } : {}),
        ...(payload.confirmDownstream ? { confirm_downstream: payload.confirmDownstream } : {}),
      }),
    },
  };
}

/** The request of an admin game delete. `confirmDownstream`: see `GameEditPayload`. */
export function gameDeleteRequest(
  gameId: string,
  payload: { reason: string; confirmDownstream?: readonly string[] },
): { url: string; init: RequestInit } {
  return {
    url: `/api/admin/games/${gameId}`,
    init: {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: payload.reason,
        ...(payload.confirmDownstream ? { confirm_downstream: payload.confirmDownstream } : {}),
      }),
    },
  };
}

/** How many later bracket matches a saved game change reset (`downstream_reset_match_ids` of its data). */
export function downstreamResetCount(data: Record<string, unknown>): number {
  const ids = data.downstream_reset_match_ids;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string').length : 0;
}

/**
 * The outcome of an admin game change request (edit, delete, match reset):
 * saved with its `data` and the warnings it carries, or refused with the
 * API's error (code, English fallback, params) for `GameChangeAlerts`.
 */
export type GameChangeResult =
  | { ok: true; data: Record<string, unknown>; warnings: ApiErrorLike[] }
  | { ok: false; error: ApiErrorLike };

/**
 * Send an admin game change and read its response. A network failure or a
 * body that is not JSON rejects (the caller shows its local "failed"
 * message); everything the API answered resolves.
 */
export async function sendGameChange(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<GameChangeResult> {
  const res = await fetchImpl(url, init);
  const json: unknown = await res.json();
  if (isRecord(json) && json.success === true) {
    const data = isRecord(json.data) ? json.data : {};
    return { ok: true, data, warnings: gameChangeWarnings(data) };
  }
  return { ok: false, error: toApiErrorLike(json) };
}
