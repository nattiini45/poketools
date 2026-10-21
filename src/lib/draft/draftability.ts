/**
 * Viewer draftability (draft-backend §7.4). Client-safe and pure; the server
 * builds `viewer.line_status` / `viewer.pick_block` of the snapshot with it,
 * and the draft room can re-evaluate locally between polls.
 *
 * The line-level checks mirror `draft__commit_pick` steps 1–5 (M5) in the same
 * order; the viewer-level checks mirror `draft_confirm_pick`'s phase, pause,
 * slot and turn checks. The SQL stays authoritative: this module only explains
 * in advance why a pick would be refused.
 *
 * Cost: one sort of the legal prices plus prefix sums, then O(log n) per line
 * (a binary search for the candidate's price; the design's "O(1) after one sort").
 * `budget.ts`' `evaluateCompletion` is the per-line reference; a seeded property test
 * checks that both agree.
 *
 * Pool gate (twin of the gate in `draft__commit_pick`, step 10b): a line the viewer could afford is still greyed
 * when, after taking it, not every participant could fill their roster (POOL_NOT_COMPLETABLE), or when that could
 * not be decided within the step cap (POOL_CHECK_LIMIT, the server refuses such a pick). The search
 * (`completability.ts`) runs at most once per (price, set of players restricted from the line) — such lines are
 * interchangeable — and not at all for a line of the viewer's own share of the current pool's completion witness
 * (taking it leaves the rest of that witness as a completion). If the current pool is not completable no pick can
 * make it completable again, so every line is POOL_NOT_COMPLETABLE without a search.
 */
import { poolCompletability, type PoolCompletability, type PoolLine, type PoolParticipant } from '@/lib/draft/completability';
import type { DraftKind, DraftPhase, LineId, PauseReason, ReasonDTO } from '@/types/draft-queue';

export interface DraftabilityInput {
  kind: DraftKind;
  phase: DraftPhase;
  paused: boolean;
  pauseReason: PauseReason | null;
  lockNoRedraftLines: boolean;
  /** Null when signed out. */
  playerId: string | null;
  isParticipant: boolean;
  /** The slot on the clock. */
  current: { slot_id: string; player_id: string } | null;
  /** The viewer's participant counters; null for non-participants. `open_slots` counts the slot a pick would fill. */
  me: { budget_remaining: number; open_slots: number; slots_total: number; open_redraft_slots: number } | null;
  /**
   * Every participant's open slots and budget left (the pool gate). The viewer's own entry is taken from `me`; a
   * missing viewer entry is added from `me`.
   */
  participants: readonly { player_id: string; open_slots: number; budget_remaining: number }[];
  /** Pool gate step cap (default: the SQL twin's cap). */
  nodeLimit?: number;
  /** Price of every line of the pool's list version. */
  prices: Readonly<Record<LineId, number>>;
  /** Line → owner player id (season-wide trackers + non-void picks of the pool). */
  taken: Readonly<Record<LineId, string>>;
  /** Restrictions of the pool (any player; only the viewer's apply). */
  restrictions: readonly { player_id: string; line_id: LineId; reason: 'own_redraft_drop' | 'admin' }[];
  /** Lines whose stored `special_rules.no_redraft` flag is set (the format pack's redraft-locked lines). */
  noRedraftLineIds: ReadonlySet<LineId>;
}

export interface DraftabilityEvaluator {
  /** Viewer-level block (turn, pause, roster, phase, signed out); null = the viewer may pick now. */
  pickBlock: ReasonDTO | null;
  /** Line-level reason, evaluated "as if it were my turn"; null = draftable. */
  lineStatus(lineId: LineId): ReasonDTO | null;
  /** Only the non-draftable lines of the list (`viewer.line_status`). */
  allLineStatus(): Record<LineId, ReasonDTO>;
  /** Viewer's budget after taking this line; null without a participant or for a line outside the list. */
  remainingAfter(lineId: LineId): number | null;
}

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Index of the first element ≥ value in an ascending array. */
function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Viewer order: SIGNED_OUT → NOT_PARTICIPANT → DRAFT_NOT_STARTED → SUBMISSION_PHASE → DRAFT_COMPLETE →
 *  DRAFT_PAUSED → ROSTER_FULL → NO_OPEN_REDRAFT_SLOT → NOT_YOUR_TURN. (No slot is ever blocked: the pool always stays
 *  completable, so SLOT_BLOCKED is no longer produced.) */
function viewerBlock(i: DraftabilityInput): ReasonDTO | null {
  if (i.playerId === null) return { code: 'SIGNED_OUT' };
  if (!i.isParticipant) return { code: 'NOT_PARTICIPANT' };
  if (i.phase === 'setup') return { code: 'DRAFT_NOT_STARTED' };
  if (i.phase === 'submissions') return { code: 'SUBMISSION_PHASE' };
  // A cancelled pool is over as well; the reason list has no separate code for it.
  if (i.phase === 'complete' || i.phase === 'cancelled') return { code: 'DRAFT_COMPLETE' };
  if (i.paused) return { code: 'DRAFT_PAUSED', params: { reason: i.pauseReason ?? 'admin' } };
  if (i.me) {
    if (i.me.open_slots < 1) return { code: 'ROSTER_FULL', params: { size: i.me.slots_total } };
    if (i.kind === 'redraft' && i.me.open_redraft_slots < 1) return { code: 'NO_OPEN_REDRAFT_SLOT' };
  }
  if (!i.current || i.current.player_id !== i.playerId) return { code: 'NOT_YOUR_TURN' };
  return null;
}

export function buildDraftabilityEvaluator(i: DraftabilityInput): DraftabilityEvaluator {
  // The viewer's own restrictions; an own-drop restriction outranks an admin one (SQL order).
  const myRestrictions = new Map<LineId, 'own_redraft_drop' | 'admin'>();
  if (i.playerId !== null) {
    for (const r of i.restrictions) {
      if (r.player_id !== i.playerId) continue;
      if (myRestrictions.get(r.line_id) !== 'own_redraft_drop') myRestrictions.set(r.line_id, r.reason);
    }
  }
  const redraftLocked = i.kind === 'redraft' && i.lockNoRedraftLines;

  const availability = (lineId: LineId): ReasonDTO | null => {
    if (!hasOwn(i.prices, lineId)) return { code: 'NOT_IN_LIST' };
    if (hasOwn(i.taken, lineId)) return { code: 'LINE_TAKEN', params: { player_id: i.taken[lineId] } };
    const restriction = myRestrictions.get(lineId);
    if (restriction === 'own_redraft_drop') return { code: 'OWN_REDRAFT_DROP' };
    if (restriction === 'admin') return { code: 'LINE_RESTRICTED' };
    if (redraftLocked && i.noRedraftLineIds.has(lineId)) return { code: 'COSMOG_REDRAFT_LOCKED' };
    return null;
  };

  // Legal prices of the viewer, ascending, with prefix sums (prefix[k] = sum of the k cheapest).
  const legal: number[] = [];
  for (const lineId of Object.keys(i.prices)) if (availability(lineId) === null) legal.push(i.prices[lineId]);
  legal.sort((a, b) => a - b);
  const prefix: number[] = [0];
  for (const price of legal) prefix.push(prefix[prefix.length - 1] + price);

  const budgetStatus = (price: number): ReasonDTO | null => {
    const me = i.me;
    if (!me || me.open_slots < 1) return null; // ROSTER_FULL / non-participant: viewer level only
    const remaining = me.budget_remaining;
    if (price > remaining) return { code: 'INSUFFICIENT_BUDGET', params: { price, remaining } };
    const slots = me.open_slots - 1;
    const available = legal.length - 1; // every other legal line
    if (available < slots) return { code: 'NOT_ENOUGH_LINES', params: { slots, available } };
    // Cheapest `slots` legal lines without one line of this price: drop it from the first slots+1 when it is among them.
    const minCost = lowerBound(legal, price) <= slots ? prefix[slots + 1] - price : prefix[slots];
    const remainingAfter = remaining - price;
    if (minCost > remainingAfter) return { code: 'BUDGET_INFEASIBLE', params: { shortfall: minCost - remainingAfter, slots } };
    return null;
  };

  // ── pool gate ──────────────────────────────────────────────────────────────────────────────────────────────────
  // Free lines of the pool: in the list, not taken, not redraft-locked for everybody.
  const poolLines: PoolLine[] = [];
  for (const lineId of Object.keys(i.prices)) {
    if (hasOwn(i.taken, lineId) || (redraftLocked && i.noRedraftLineIds.has(lineId))) continue;
    poolLines.push({ lineId, price: i.prices[lineId] });
  }
  const restrictedFor = new Map<string, Set<LineId>>();
  const restrictedPlayers = new Map<LineId, string[]>();
  for (const r of i.restrictions) {
    let lines = restrictedFor.get(r.player_id);
    if (!lines) restrictedFor.set(r.player_id, (lines = new Set<LineId>()));
    if (lines.has(r.line_id)) continue;
    lines.add(r.line_id);
    restrictedPlayers.set(r.line_id, [...(restrictedPlayers.get(r.line_id) ?? []), r.player_id]);
  }
  let participantsMemo: PoolParticipant[] | null = null;
  const poolParticipants = (): PoolParticipant[] => {
    if (participantsMemo) return participantsMemo;
    const out: PoolParticipant[] = [];
    let sawMe = false;
    for (const p of i.participants) {
      const mine = p.player_id === i.playerId && i.me !== null;
      sawMe ||= mine;
      out.push({
        playerId: p.player_id,
        openSlots: mine && i.me ? i.me.open_slots : p.open_slots,
        budget: mine && i.me ? i.me.budget_remaining : p.budget_remaining,
        excludedLineIds: restrictedFor.get(p.player_id),
      });
    }
    if (!sawMe && i.me && i.playerId !== null) {
      out.push({
        playerId: i.playerId,
        openSlots: i.me.open_slots,
        budget: i.me.budget_remaining,
        excludedLineIds: restrictedFor.get(i.playerId),
      });
    }
    participantsMemo = out;
    return out;
  };
  let base: PoolCompletability | null = null;
  const poolCache = new Map<string, ReasonDTO | null>();
  const poolStatus = (lineId: LineId, price: number): ReasonDTO | null => {
    const me = i.me;
    const viewer = i.playerId;
    if (!me || viewer === null || me.open_slots < 1) return null;
    const participants = poolParticipants();
    base ??= poolCompletability({ lines: poolLines, participants, nodeLimit: i.nodeLimit });
    if (base.status === 'not_completable') return { code: 'POOL_NOT_COMPLETABLE' };
    if (base.status === 'completable' && base.witness[viewer]?.includes(lineId)) return null;
    const key = `${price}|${[...(restrictedPlayers.get(lineId) ?? [])].sort().join(',')}`;
    if (poolCache.has(key)) return poolCache.get(key) ?? null;
    const after = poolCompletability({
      lines: poolLines.filter((l) => l.lineId !== lineId),
      participants: participants.map((p) =>
        p.playerId === viewer ? { ...p, openSlots: p.openSlots - 1, budget: p.budget - price } : p,
      ),
      nodeLimit: i.nodeLimit,
    });
    const reason: ReasonDTO | null =
      after.status === 'completable'
        ? null
        : after.status === 'undecided'
          ? { code: 'POOL_CHECK_LIMIT' }
          : { code: 'POOL_NOT_COMPLETABLE' };
    poolCache.set(key, reason);
    return reason;
  };

  const lineStatus = (lineId: LineId): ReasonDTO | null =>
    availability(lineId) ?? budgetStatus(i.prices[lineId]) ?? poolStatus(lineId, i.prices[lineId]);

  return {
    pickBlock: viewerBlock(i),
    lineStatus,
    allLineStatus() {
      const out: Record<LineId, ReasonDTO> = {};
      for (const lineId of Object.keys(i.prices)) {
        const reason = lineStatus(lineId);
        if (reason) out[lineId] = reason;
      }
      return out;
    },
    remainingAfter(lineId) {
      if (!i.me || !hasOwn(i.prices, lineId)) return null;
      return i.me.budget_remaining - i.prices[lineId];
    },
  };
}

