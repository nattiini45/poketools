/** Draft UI timing constants (draft-frontend §5.1, §5.6, §5.8). Pure, client-safe. */

/** Hover-intent delay before the hover details open (SPEC:383: 500–700 ms). */
export const HOVER_DELAY_MS = 600;

/** The confirm button stays disabled this long after the dialog opens or re-arms (SPEC:494: 1–1.5 s). */
export const CONFIRM_ARM_MS = 1200;

/** Snapshot poll cadence while the tab is visible (AGENTS.md D37). */
export const SNAPSHOT_POLL_MS = 3000;

/** The my-turn watch cadence; it also runs in hidden tabs (product decision, draft-frontend §5.8). */
export const TURN_WATCH_INTERVAL_MS = 60_000;

/** How many picks the "last picks" strip shows, newest first. */
export const RECENT_PICKS_COUNT = 3;
