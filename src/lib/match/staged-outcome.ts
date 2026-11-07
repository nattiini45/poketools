/**
 * Raised by `stageAdminOutcome` when the match is already disputed by a replay-tie: its `unresolved` outcome row belongs
 * to the dispute and an admin result staged over it would destroy it (the status write that follows can only lose, as the
 * match left `in_progress`). The caller answers a state conflict instead.
 */
export class StagedOutcomeBlockedError extends Error {
  constructor(readonly status: 'disputed') {
    super(`The match is ${status}: its unresolved outcome is not replaced by a staged admin result`);
    this.name = 'StagedOutcomeBlockedError';
  }
}
