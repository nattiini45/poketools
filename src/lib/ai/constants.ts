import { logger } from '@/lib/logger';

/** Max age of an in-progress AI analysis before it's considered stale (ms). */
export const AI_ANALYSIS_STALE_MS = 5 * 60 * 1000;

// ─── Model configuration ────────────────────────────────────────────
//
// One resolver per setting, shared by the raw-SDK client, the Kale provider and the routes that
// stamp `model_id` on a stored row. Every text surface (match analysis, scouting, the coaches, the
// recap and Kale) uses the same two models and the same effort. Every override uses `||`, so an
// empty environment value falls back to the default instead of becoming an invalid model id. Read
// at call time, never cached at import.

/** Code default for the Claude model on every text surface (`CLAUDE_MODEL`). */
export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Code default for the Claude fallback model on every text surface (`CLAUDE_FALLBACK_MODEL`). */
export const CLAUDE_DEFAULT_FALLBACK_MODEL = 'claude-haiku-5-5';

/** The model every text surface asks first (`CLAUDE_MODEL`). */
export function getClaudeModelId(): string {
  return process.env.CLAUDE_MODEL || CLAUDE_DEFAULT_MODEL;
}

/** The model every text surface falls back to on a transient failure (`CLAUDE_FALLBACK_MODEL`). */
export function getClaudeFallbackModelId(): string {
  return process.env.CLAUDE_FALLBACK_MODEL || CLAUDE_DEFAULT_FALLBACK_MODEL;
}

// ─── Effort ─────────────────────────────────────────────────────────

/** The `output_config.effort` levels of the Messages API. */
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaudeEffort = (typeof CLAUDE_EFFORT_LEVELS)[number];

/** Code default for `CLAUDE_API_EFFORT`. */
export const CLAUDE_DEFAULT_EFFORT: ClaudeEffort = 'medium';

/** Invalid `CLAUDE_API_EFFORT` values already warned about, so a bad setting warns once, not per call. */
const warnedEffortValues = new Set<string>();

/**
 * Parse a `CLAUDE_API_EFFORT` value. Unset or empty means the default; an unrecognised value warns
 * (once per distinct value) and also means the default, so a typo never reaches the API as a 400.
 */
export function parseClaudeEffort(raw: string | undefined): ClaudeEffort {
  const value = raw?.trim().toLowerCase();
  if (!value) return CLAUDE_DEFAULT_EFFORT;
  if ((CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value)) return value as ClaudeEffort;
  if (!warnedEffortValues.has(value)) {
    warnedEffortValues.add(value);
    logger.warn(
      'ai/constants',
      `Unknown CLAUDE_API_EFFORT, using "${CLAUDE_DEFAULT_EFFORT}" (expected one of ${CLAUDE_EFFORT_LEVELS.join(', ')})`,
      { value: value.slice(0, 40) }
    );
  }
  return CLAUDE_DEFAULT_EFFORT;
}

/** The effort every text surface asks for (`CLAUDE_API_EFFORT`, default `medium`). */
export function getClaudeEffort(): ClaudeEffort {
  return parseClaudeEffort(process.env.CLAUDE_API_EFFORT);
}

// ─── Output caps ────────────────────────────────────────────────────
//
// The models think adaptively and the thinking counts against `max_tokens`, so a cap is sized for
// the thinking plus the visible answer, not for the answer alone. The real limit on how much a call
// can produce is the client's wall-clock deadline per attempt (150 s for the first model, 90 s for
// the fallback, see `client.ts`), not a token count: a larger cap only helps if the model can
// finish inside that time.

export const AI_MAX_TOKENS = {
  /** Post-match analysis and match-prep scouting (both stream). */
  analysis: 16_000,
  /** Slot coach and team coach (single response). */
  coach: 8_000,
  /** Broadcast round recap paragraph (single response). */
  recap: 4_096,
  /**
   * One Kale task. A decomposed task asks for a sentence up to a few paragraphs, a single-mode
   * task for one JSON report; the cap covers that visible text plus the model's thinking.
   */
  kaleTask: 4_096,
} as const;
