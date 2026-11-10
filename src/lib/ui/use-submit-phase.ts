'use client';

import { useCallback, useRef, useState } from 'react';
import { submitPhaseMachine, type SubmitOutcome, type SubmitPhase } from './submit-phase-state';

export interface SubmitPhaseHook {
  phase: SubmitPhase;
  /** A submit is allowed now (`idle` or `failed`). */
  canSubmit: boolean;
  /**
   * Runs one submission when the machine allows it and moves to the outcome `task` returns. A second call while one
   * runs, or after `done`, does nothing. A task that throws moves to `failed` and rethrows.
   */
  run(task: () => Promise<SubmitOutcome>): Promise<void>;
}

type Entry = { key: string; phase: SubmitPhase };

/**
 * The phase of a form submission (machine `client.submit_phase`, `submit-phase-state.ts`). A new `resetKey` is a new
 * form: its submission starts at `idle` (EpbImportPanel keys it by the file and options).
 */
export function useSubmitPhase(resetKey = ''): SubmitPhaseHook {
  const [entry, setEntry] = useState<Entry>({ key: resetKey, phase: 'idle' });
  // The guard reads a ref, so a second click before the re-render is refused too.
  const latest = useRef<Entry>(entry);

  const run = useCallback(
    async (task: () => Promise<SubmitOutcome>) => {
      const move = (phase: SubmitPhase) => {
        latest.current = { key: resetKey, phase };
        setEntry(latest.current);
      };
      const from = latest.current.key === resetKey ? latest.current.phase : 'idle';
      if (!submitPhaseMachine.can(from, 'submitting', 'viewer')) return;
      move('submitting');
      let outcome: SubmitOutcome;
      try {
        outcome = await task();
      } catch (err) {
        if (latest.current.key === resetKey) move('failed');
        throw err;
      }
      if (latest.current.key === resetKey && submitPhaseMachine.can('submitting', outcome, 'request')) move(outcome);
    },
    [resetKey],
  );

  const phase = entry.key === resetKey ? entry.phase : 'idle';
  return { phase, canSubmit: submitPhaseMachine.can(phase, 'submitting', 'viewer'), run };
}
