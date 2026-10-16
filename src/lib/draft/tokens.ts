/**
 * Token rules (draft-backend §7.5, §6.9, §10.3; SPEC Prompt 7 B–C; BR-4, BR-5).
 * Client-safe and pure. The SQL twin of the Draft Kill Token rules is
 * `epb_purchase_draft_token` (M7); `draftKillLineRefusal` checks in its order.
 *
 * Thresholds are cumulative (`toCumulativeThresholds`, override applied by
 * `effectiveThresholds`): stage 2 at `stage2_kos`, stage 3 at `stage3_kos`.
 */
import { comebackTokensFromTable } from '@/lib/format-pack';
import type { DraftPhase, TokenRefusalCode } from '@/types/draft-queue';

/** Progress needed for the next stage; null when the line is fully evolved (stage 3, or stage 2 of a two-stage line). */
export function nextThresholdFor(t: { stage2_kos: number; stage3_kos: number | null }, currentStage: number): number | null {
  if (currentStage <= 1) return t.stage2_kos;
  if (currentStage === 2) return t.stage3_kos;
  return null;
}

/**
 * A Draft Kill Token adds +1 progress and may never directly trigger an evolution
 * (SPEC Prompt 7 B): refused when `progress + 1` reaches the next threshold.
 * Igglybuff (needs 1) is refused at 0; Chikorita (needs 2) may go 0 → 1; 4/5 is refused.
 */
export function draftKillTokenCheck(i: {
  totalProgress: number;
  nextThreshold: number | null;
}):
  | { ok: true }
  | { ok: false; code: 'TOKEN_WOULD_EVOLVE'; params: { next: number; progress: number } }
  | { ok: false; code: 'LINE_FULLY_EVOLVED' } {
  if (i.nextThreshold === null) return { ok: false, code: 'LINE_FULLY_EVOLVED' };
  if (i.totalProgress + 1 >= i.nextThreshold) {
    return { ok: false, code: 'TOKEN_WOULD_EVOLVE', params: { next: i.nextThreshold, progress: i.totalProgress } };
  }
  return { ok: true };
}

export type DraftKillWindow = 'before' | 'open' | 'closed';

/**
 * Purchase window: open iff the initial draft is complete AND (an explicit `closesAt`
 * is still in the future, or — without one — no league match result is confirmed yet;
 * the default cutoff is the first confirmed result). SQL twin: §6.9 (critique B10).
 * An unparsable `closesAt` counts as closed.
 */
export function draftKillTokenWindow(i: {
  initialPhase: DraftPhase | null;
  closesAt: string | null;
  anyLeagueMatchConfirmed: boolean;
  now: Date;
}): DraftKillWindow {
  if (i.initialPhase !== 'complete') return 'before';
  if (i.closesAt !== null) {
    const closesAtMs = Date.parse(i.closesAt);
    return Number.isFinite(closesAtMs) && i.now.getTime() < closesAtMs ? 'open' : 'closed';
  }
  return i.anyLeagueMatchConfirmed ? 'closed' : 'open';
}

/**
 * First refusal for one owned line, in the SQL order of `epb_purchase_draft_token`:
 * window → player limit → line limit → unspent points → fully evolved → would evolve.
 * (`TRACKER_NOT_OWNED` sits between points and fully evolved in SQL; callers only ask
 * for lines the player owns.) Null = eligible.
 */
export function draftKillLineRefusal(i: {
  window: DraftKillWindow;
  /** Draft Kill Tokens the player already owns (purchases + legacy grant tokens). */
  owned: number;
  max: number;
  lineHasToken: boolean;
  unspentPoints: number;
  cost: number;
  totalProgress: number;
  nextThreshold: number | null;
}): TokenRefusalCode | null {
  if (i.window !== 'open') return 'TOKEN_WINDOW_CLOSED';
  if (i.owned >= i.max) return 'TOKEN_PLAYER_LIMIT';
  if (i.lineHasToken) return 'TOKEN_LINE_LIMIT';
  if (i.unspentPoints < i.cost) return 'TOKEN_POINTS_SHORT';
  const check = draftKillTokenCheck({ totalProgress: i.totalProgress, nextThreshold: i.nextThreshold });
  return check.ok ? null : check.code;
}

/**
 * Comeback Tokens earned by a shutout loss, from the surviving-Pokémon score
 * (loser 0 alive): the format pack's comeback table (`epb.comeback.table`); no shutout → 0.
 * Same mapping as `computeKillTokens` (`point-buy-engine.ts`), declared here so this
 * module stays inside the client-safe import allowlist; a test pins both together.
 */
export function comebackTokensForLoss(loserSurvivors: number, winnerSurvivors: number): number {
  return comebackTokensFromTable(loserSurvivors, winnerSurvivors);
}

/** Unspent Comeback Tokens: `max(0, earned − spent)`. A negative raw value is the caller's to log. */
export function comebackBalance(earned: number, spent: number): number {
  return Math.max(0, earned - spent);
}

/** Comeback Tokens can be spent once the redraft is complete, or after the admin opened spending (BR-5, NQ 34). */
export function comebackSpendOpen(i: { redraftComplete: boolean; adminOpened: boolean }): boolean {
  return i.redraftComplete || i.adminOpened;
}
