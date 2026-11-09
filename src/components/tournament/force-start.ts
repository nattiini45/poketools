/** The reason codes the first-round guard reports in a 409 `format_not_ready` (`params.reasons`, comma separated). */
export type FormatNotReadyReason = 'relation_undrawn' | 'action_incomplete';

/**
 * The reasons of a `format_not_ready` answer, or null for any other answer: the dialog that offers "start anyway" opens
 * only for this one. Unknown codes are dropped (a newer server may add some); the dialog still opens without reasons.
 * Shared by RoundManager (Generate / Generate all) and ManualRoundForm (the manual editor), which all reach the guard.
 */
export function formatNotReadyReasons(result: { code?: string; params?: Record<string, string | number> }): FormatNotReadyReason[] | null {
  if (result.code !== 'format_not_ready') return null;
  const raw = result.params?.reasons;
  const codes = typeof raw === 'string' ? raw.split(',') : [];
  return codes.filter((code): code is FormatNotReadyReason => code === 'relation_undrawn' || code === 'action_incomplete');
}
