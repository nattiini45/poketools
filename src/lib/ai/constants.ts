/** Max age of an in-progress AI analysis before it's considered stale (ms). */
export const AI_ANALYSIS_STALE_MS = 5 * 60 * 1000;

// ─── Model configuration ────────────────────────────────────────────
//
// One resolver per setting, shared by the raw-SDK client, the Kale provider and the routes that
// stamp `model_id` on a stored row. Every override uses `||`, so an empty environment value falls
// back to the default instead of becoming an invalid model id. Read at call time, never cached at
// import.

/** Code default for the Claude model on the legacy and Kale surfaces. */
export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Code default for the Claude fallback model on the legacy raw-SDK surfaces. */
export const CLAUDE_DEFAULT_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

/** The model the legacy raw-SDK client asks first (`CLAUDE_MODEL`). */
export function getClaudeModelId(): string {
  return process.env.CLAUDE_MODEL || CLAUDE_DEFAULT_MODEL;
}

/** The model the legacy raw-SDK client falls back to (`CLAUDE_FALLBACK_MODEL`). */
export function getClaudeFallbackModelId(): string {
  return process.env.CLAUDE_FALLBACK_MODEL || CLAUDE_DEFAULT_FALLBACK_MODEL;
}

/** The model the Kale pipeline asks first (`KALE_MODEL`, then `CLAUDE_MODEL`). */
export function getKaleModelId(): string {
  return process.env.KALE_MODEL || getClaudeModelId();
}
