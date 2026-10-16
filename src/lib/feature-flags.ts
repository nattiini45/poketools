/**
 * Centralized feature flags.
 *
 * Use NEXT_PUBLIC_ prefix so flags are available in both
 * server components/routes and client components.
 */

/** Soft-deprecated Kale Cabbage AI sports journalist — default disabled. */
export const ENABLE_KALE_CABBAGE = process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE === 'true';

/**
 * Route the scouting card through the new tool-driven agent endpoint
 * (`/api/ai/agent/analyze-match`, free-text) instead of the legacy SSE route.
 * Default disabled — the legacy route stays the rollback path.
 *
 * NOTE: post-match analysis has its own flag ({@link ENABLE_AGENT_POST_MATCH})
 * so the two cards can cut over independently — flipping post-match must not
 * force scouting to free-text.
 */
export const ENABLE_AGENT_MATCH_ANALYSIS =
  process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS === 'true';

/**
 * Route the post-match analysis card through the agent endpoint
 * (`/api/ai/agent/analyze-match`, `post_match`). The agent persists the SAME
 * structured `MatchAnalysisContent` the cards render, so the card keeps its
 * reload-on-done flow — only the endpoint changes. Default disabled; the legacy
 * `/api/ai/match-analysis` route stays the rollback path.
 */
export const ENABLE_AGENT_POST_MATCH =
  process.env.NEXT_PUBLIC_AGENT_POST_MATCH === 'true';
