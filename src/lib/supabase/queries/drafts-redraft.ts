/**
 * Redraft secret-drop reads (draft-backend §8.1 #18–#21, §10.4; package B-RED).
 *
 * SECRECY: `redraft_submissions` holds every player's SECRET drop list until the
 * redraft is published. Nothing here is a cached public read, and the only two
 * readers are:
 * - `getOwnRedraftSubmission` — always filtered by ONE player id, which the
 *   route takes from the session (or from `?player_id=` after the pool-admin
 *   guard);
 * - `listRedraftSubmissions` — every player's list, only behind
 *   `requireDraftAdmin`.
 * The snapshot RPC never reads this table (M6), so the public poll cannot leak it.
 *
 * Player names come from `players.name` (a public field); no other player
 * column is selected.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { DraftRuleError } from '@/lib/draft/errors';
import { SQL_REDRAFT_MAX_LINES_FALLBACK } from '@/lib/draft/sql-fallbacks';
import { formatPack } from '@/lib/format-pack';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import type { DraftPool } from '@/types/draft';
import type { AdminSubmissionDTO, LineId, RedraftSubmissionDTO } from '@/types/draft-queue';

/**
 * Redraft line cap the submission DTO advertises when the pool's `redraft_max_lines` is NULL. It must
 * match what `redraft_set_submission` enforces, which takes no max and falls back to its own SQL
 * literal; so this mirrors that literal, not the format pack. No pool-creation path sends the pack's
 * `epb.defaults.redraftMaxLines` (docs/format-packs.md, "SQL residuals").
 */
export const DEFAULT_REDRAFT_MAX_LINES = SQL_REDRAFT_MAX_LINES_FALLBACK;
/** Ledger fallbacks, as the legacy redraft route uses them (`format_rules` missing; format pack). */
const DEFAULT_DRAFT_BUDGET = formatPack.epb.defaults.draftBudget;
const DEFAULT_TOKEN_RATIO = formatPack.epb.defaults.tokenRatio;

export interface OwnSubmission {
  line_ids: LineId[];
  updated_at: string | null;
}

/** Is the player seated in this pool? (One narrow read.) */
export async function isPoolParticipant(poolId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('draft_participants')
    .select('player_id')
    .eq('draft_pool_id', poolId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** ONE player's secret drop list (sorted line ids; `updated_at` = newest row, null when empty). */
export async function getOwnRedraftSubmission(poolId: string, playerId: string): Promise<OwnSubmission> {
  const { data, error } = await supabase
    .from('redraft_submissions')
    .select('line_id, updated_at')
    .eq('draft_pool_id', poolId)
    .eq('player_id', playerId);
  if (error) throw error;
  const rows = data ?? [];
  const lineIds = [...new Set(rows.map((r) => r.line_id))].sort();
  let updatedAt: string | null = null;
  for (const r of rows) if (updatedAt === null || r.updated_at > updatedAt) updatedAt = r.updated_at;
  return { line_ids: lineIds, updated_at: updatedAt };
}

/**
 * Every participant's secret drop list (pool admins only; the route guards it).
 * Players without a submission are not listed. Ordered by player name.
 */
export async function listRedraftSubmissions(poolId: string): Promise<AdminSubmissionDTO[]> {
  const { data, error } = await supabase
    .from('redraft_submissions')
    .select('player_id, line_id, updated_at')
    .eq('draft_pool_id', poolId);
  if (error) throw error;

  const byPlayer = new Map<string, { line_ids: Set<string>; updated_at: string }>();
  for (const r of data ?? []) {
    const entry = byPlayer.get(r.player_id);
    if (entry) {
      entry.line_ids.add(r.line_id);
      if (r.updated_at > entry.updated_at) entry.updated_at = r.updated_at;
    } else {
      byPlayer.set(r.player_id, { line_ids: new Set([r.line_id]), updated_at: r.updated_at });
    }
  }
  if (byPlayer.size === 0) return [];

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name')
    .in('id', [...byPlayer.keys()]);
  if (playersError) throw playersError;
  const nameOf = new Map((players ?? []).map((p) => [p.id, p.name] as const));

  return [...byPlayer.entries()]
    .map(([playerId, s]) => ({
      player_id: playerId,
      player_name: nameOf.get(playerId) ?? '',
      line_ids: [...s.line_ids].sort(),
      updated_at: s.updated_at,
    }))
    .sort((a, b) => a.player_name.localeCompare(b.player_name) || a.player_id.localeCompare(b.player_id));
}

/** Submission locked: not in the submission phase, no deadline, or the deadline has passed (= `SUBMISSION_LOCKED` in M6). */
export function isSubmissionLocked(pool: Pick<DraftPool, 'phase' | 'submission_deadline_at'>, now: Date = new Date()): boolean {
  if (pool.phase !== 'submissions' || !pool.submission_deadline_at) return true;
  return now.getTime() >= new Date(pool.submission_deadline_at).getTime();
}

/**
 * The submission view of ONE player (`RedraftSubmissionDTO`): their stored
 * drop list (or `submission`, the RPC result of a just-saved list), their
 * own lines from their trackers (price from the pool's list version,
 * `droppable = false` for `no_redraft` lines) and `leftover_budget` =
 * `seasonRemainingPoints` (twin of `epb__season_remaining_points`).
 */
export async function buildRedraftSubmissionDTO(
  pool: DraftPool,
  playerId: string,
  submission?: OwnSubmission,
): Promise<RedraftSubmissionDTO> {
  const listVersionId = pool.list_version_id ?? (await getSeasonById(pool.season_id))?.point_buy_list_id ?? null;
  const [own, trackers, entries, rules] = await Promise.all([
    submission ? Promise.resolve(submission) : getOwnRedraftSubmission(pool.id, playerId),
    getPlayerTrackers(pool.season_id, playerId),
    listVersionId ? getListEntries(listVersionId) : Promise.resolve([]),
    getFormatRules(pool.season_id),
  ]);
  const leftover = await computeRemainingPoints(
    pool.season_id,
    playerId,
    rules?.draft_budget ?? DEFAULT_DRAFT_BUDGET,
    rules?.draft_token_ratio ?? DEFAULT_TOKEN_RATIO,
  );

  const entryByLine = new Map(entries.filter((e) => e.line_id).map((e) => [e.line_id as string, e] as const));
  const ownLines = trackers
    .filter((t): t is typeof t & { line_id: string } => typeof t.line_id === 'string' && t.line_id !== '')
    .map((t) => {
      const entry = entryByLine.get(t.line_id);
      return {
        line_id: t.line_id,
        real_kills: t.real_kills ?? 0,
        price: entry?.price ?? 0,
        droppable: entry?.special_rules?.no_redraft !== true,
      };
    })
    .sort((a, b) => b.price - a.price || a.line_id.localeCompare(b.line_id));

  return {
    line_ids: [...own.line_ids],
    updated_at: own.updated_at,
    locked: isSubmissionLocked(pool),
    deadline_at: pool.submission_deadline_at ?? '',
    max: pool.redraft_max_lines ?? DEFAULT_REDRAFT_MAX_LINES,
    own_lines: ownLines,
    leftover_budget: leftover,
  };
}

/**
 * Seats from an admin-chosen redraft order (seat 1 picks first). The order
 * must be exactly the season's participant set (`SEATS_INVALID`); only ids are
 * read. Same rule as the config route (B-ADM).
 */
export async function redraftSeatsFromOrder(
  seasonId: string,
  order: readonly string[],
): Promise<{ player_id: string; seat: number }[]> {
  const participants = await getSeasonParticipants(seasonId);
  const ids = new Set(participants.map((p) => p.id));
  if (order.length !== ids.size || order.some((pid) => !ids.has(pid))) throw new DraftRuleError('SEATS_INVALID');
  return order.map((player_id, index) => ({ player_id, seat: index + 1 }));
}

// ── Published drops (Discord `draft_redraft_published`, B-CRON) ──────

/** One public drop of a published redraft (canonical English names; the Discord embed reads it). */
export interface PublishedDrop {
  player_id: string;
  label: string;
  base: string;
  stage3: string | null;
  transferred_real_kills: number;
}

/** "teddiursa--ursalunabloodmoon" → ids, the last resort when the list entry is gone. */
function namesFromLineId(lineId: string): { base: string; stage3: string | null } {
  const [base, final] = lineId.split('--');
  return { base: base ?? lineId, stage3: final ?? null };
}

/** The public drops of a published redraft pool with their lines as canonical English names. */
export async function getPublishedDrops(poolId: string): Promise<PublishedDrop[]> {
  const [{ data: slots, error: slotError }, { data: pool, error: poolError }] = await Promise.all([
    supabase
      .from('redraft_slots')
      .select('player_id, label, dropped_line_id, transferred_real_kills')
      .eq('draft_pool_id', poolId),
    supabase.from('draft_pools').select('list_version_id').eq('id', poolId).maybeSingle(),
  ]);
  if (slotError) throw slotError;
  if (poolError) throw poolError;
  if (!slots || slots.length === 0) return [];

  const names = new Map<string, { base: string; stage3: string | null }>();
  const lineIds = [...new Set(slots.map((s) => s.dropped_line_id))];
  if (pool?.list_version_id) {
    const { data: entries, error } = await supabase
      .from('point_buy_list_entries')
      .select('line_id, base_pokemon, stage3_pokemon')
      .eq('list_version_id', pool.list_version_id)
      .in('line_id', lineIds);
    if (error) throw error;
    for (const e of entries ?? []) names.set(e.line_id, { base: e.base_pokemon, stage3: e.stage3_pokemon });
  }

  return slots.map((s) => ({
    player_id: s.player_id,
    label: s.label,
    ...(names.get(s.dropped_line_id) ?? namesFromLineId(s.dropped_line_id)),
    transferred_real_kills: s.transferred_real_kills,
  }));
}
