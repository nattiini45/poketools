/**
 * Pure helpers of the token centre (draft-frontend §6.2). Client-safe, no
 * React, no text: callers translate.
 *
 * - `lineNameParts`: the canonical English names a line is displayed with
 *   (localized at render through the pkmn layer).
 * - `comebackPreview`: the live preview of a Comeback Token allocation. It
 *   uses the catalog's cumulative, override-aware thresholds (never
 *   hard-coded ones) and falls back to the DTO's `next_threshold` for a line
 *   the catalog does not know. Comeback Tokens may evolve a line (SPEC:841),
 *   even by two stages. Tokens convert to progress at the line's
 *   `comeback_tokens_per_progress` (a participation line may need more than 1
 *   token per progress point); the stepper moves in whole progress points.
 * - `visibleRefusal`: which Draft Kill Token refusal a line row shows; the
 *   window and the per-player limit are shown once on the card instead, and a
 *   line that already has its token shows a badge. A line whose token counts as
 *   several (`tokens_used` > 1) shows the allowance refusal itself while the
 *   player still has some tokens left, because the card-level note does not apply.
 */
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { LineId, TokenOverviewDTO, TokenRefusalCode } from '@/types/draft-queue';

export type TokenLine = TokenOverviewDTO['lines'][number];
export type DraftKillLine = TokenOverviewDTO['draft_kill']['lines'][number];

/** One Comeback Token allocation (the port's shape; the HTTP body calls it `count`). */
export interface ComebackAllocation {
  line_id: LineId;
  tokens: number;
}

/** BE #27 limits (`comebackSpendSchema`): 1..9 lines, 1..20 tokens per line. */
export const COMEBACK_MAX_LINES = 9;
export const COMEBACK_MAX_PER_LINE = 20;

export function catalogById(catalog: DraftLineCatalog): Map<LineId, DraftLineCatalogEntry> {
  return new Map(catalog.lines.map((l) => [l.lineId, l]));
}

export interface LineNameParts {
  base: string;
  stage3: string | null;
}

/** Canonical English base/final names, or null when the catalog lacks the line (render the id). */
export function lineNameParts(entry: DraftLineCatalogEntry | undefined): LineNameParts | null {
  if (!entry) return null;
  return { base: entry.stages[0].name, stage3: entry.stages[2]?.name ?? null };
}

/** The canonical English name of the line's form at `stage`, or null. */
export function formAt(entry: DraftLineCatalogEntry | undefined, stage: number): string | null {
  return entry?.stages.find((s) => s.stage === stage)?.name ?? null;
}

function finalStage(entry: DraftLineCatalogEntry): 2 | 3 {
  return entry.stages.length >= 3 ? 3 : 2;
}

/** The cumulative threshold to reach the stage after `stage`, or null when final. */
function nextCumulative(entry: DraftLineCatalogEntry, stage: number): number | null {
  if (stage >= finalStage(entry)) return null;
  return stage <= 1 ? entry.thresholds.cumulative[0] : entry.thresholds.cumulative[1];
}

export interface ComebackPreview {
  lineId: LineId;
  /** Comeback Tokens put on the line. */
  tokens: number;
  /** Progress those tokens add (`floor(tokens / comeback_tokens_per_progress)`). */
  added: number;
  from: number;
  to: number;
  /** The threshold after the spend; null when the line is (or becomes) fully evolved. */
  next: number | null;
  stageBefore: 1 | 2 | 3;
  stageAfter: 1 | 2 | 3;
  /** Canonical English name of the form it evolves to, when the spend evolves it. */
  evolvesTo: string | null;
}

/** Comeback Tokens per progress point on `line` (the stepper's step); never below 1. */
export function comebackStep(line: Pick<TokenLine, 'comeback_tokens_per_progress'>): number {
  return Math.max(1, Math.floor(line.comeback_tokens_per_progress));
}

/** The result of putting `tokens` Comeback Tokens on `line`. */
export function comebackPreview(
  line: TokenLine,
  tokens: number,
  entry: DraftLineCatalogEntry | undefined,
): ComebackPreview {
  const added = Math.floor(Math.max(0, tokens) / comebackStep(line));
  const from = line.total_progress;
  const to = from + added;
  let stage: 1 | 2 | 3 = line.stage;

  if (entry) {
    for (let next = nextCumulative(entry, stage); next !== null && to >= next; next = nextCumulative(entry, stage)) {
      stage = stage === 1 ? 2 : 3;
    }
    return {
      lineId: line.line_id,
      tokens,
      added,
      from,
      to,
      next: nextCumulative(entry, stage),
      stageBefore: line.stage,
      stageAfter: stage,
      evolvesTo: stage !== line.stage ? formAt(entry, stage) : null,
    };
  }

  // Unknown line: one step at most, from the DTO's own threshold.
  const evolves = line.next_threshold !== null && to >= line.next_threshold && line.stage < 3;
  const after: 1 | 2 | 3 = evolves ? (line.stage === 1 ? 2 : 3) : line.stage;
  return {
    lineId: line.line_id,
    tokens,
    added,
    from,
    to,
    next: evolves ? null : line.next_threshold,
    stageBefore: line.stage,
    stageAfter: after,
    evolvesTo: null,
  };
}

/** Non-zero allocations in line order, ready for the port. */
export function toAllocations(counts: ReadonlyMap<LineId, number>, order: readonly LineId[]): ComebackAllocation[] {
  return order
    .map((lineId) => ({ line_id: lineId, tokens: counts.get(lineId) ?? 0 }))
    .filter((a) => a.tokens > 0);
}

export function allocatedTotal(counts: ReadonlyMap<LineId, number>): number {
  let sum = 0;
  for (const n of counts.values()) sum += n;
  return sum;
}

/**
 * The most tokens a line may still get: the unspent balance minus what other
 * lines hold, capped by the per-line limit, rounded down to a multiple of the
 * line's `step` (tokens per progress point; the RPC refuses other counts); 0
 * when the line cap of the request is already used by other lines.
 */
export function maxForLine(counts: ReadonlyMap<LineId, number>, lineId: LineId, unspent: number, step = 1): number {
  const own = counts.get(lineId) ?? 0;
  const others = allocatedTotal(counts) - own;
  let otherLines = 0;
  for (const [id, n] of counts) if (id !== lineId && n > 0) otherLines += 1;
  if (own === 0 && otherLines >= COMEBACK_MAX_LINES) return 0;
  const cap = Math.max(0, Math.min(COMEBACK_MAX_PER_LINE, unspent - others));
  const unit = Math.max(1, Math.floor(step));
  return cap - (cap % unit);
}

/**
 * The refusal a Draft Kill Token row shows, or null. The window states and
 * the per-player limit are card-level messages, so the rows do not repeat them,
 * except a line whose token counts as several: it can exceed the allowance while
 * the player still owns fewer than `max` (the card shows no limit note then).
 */
export function visibleRefusal(
  line: DraftKillLine,
  dk?: Pick<TokenOverviewDTO['draft_kill'], 'owned' | 'max'>,
): TokenRefusalCode | null {
  if (line.eligible || line.reason === null || line.has_token) return null;
  if (line.reason === 'TOKEN_WINDOW_CLOSED') return null;
  if (line.reason === 'TOKEN_PLAYER_LIMIT') {
    return dk !== undefined && line.tokens_used > 1 && dk.owned < dk.max ? line.reason : null;
  }
  return line.reason;
}

/**
 * Params for `draft/tokens.reason.<code>`, all from the DTO. `cost` is the line's own price (a
 * participation line costs several times the base price), `tokens` what its token counts as and
 * `left` the tokens the player may still use.
 */
export function refusalParams(
  line: DraftKillLine,
  dk: Pick<TokenOverviewDTO['draft_kill'], 'max' | 'owned' | 'unspent_points'>,
): { progress: number; next: number; max: number; cost: number; unspent: number; tokens: number; left: number } {
  return {
    progress: line.progress,
    next: line.next_threshold ?? line.progress,
    max: dk.max,
    cost: line.cost,
    unspent: dk.unspent_points,
    tokens: line.tokens_used,
    left: Math.max(0, dk.max - dk.owned),
  };
}
