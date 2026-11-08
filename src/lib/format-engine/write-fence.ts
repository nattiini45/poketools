/**
 * The revision fence of a round write planned from a kit phase. `round_write` (and so `createRoundWithMatches` /
 * `addMatchesToRound`) checks `expected_revision` under the league's locks and refuses the write with
 * `format_context_stale` when the format was replaced, switched or detached after the phase was read; nothing is
 * written, and the admin generates again against the current format. A phase the kit does not run carries no fence.
 */
export function kitWriteFence(kitPhase: { revision: number } | null): { expected_revision?: number } {
  return typeof kitPhase?.revision === 'number' ? { expected_revision: kitPhase.revision } : {};
}
