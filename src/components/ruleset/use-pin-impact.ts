'use client';

import { useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { pinImpactRequest, type PinTargetRef } from '@/lib/ruleset-studio/editor/api';
import type { PinImpact } from '@/lib/ruleset-studio/pin-info';
import type { FetchLike } from '@/lib/studio-core/request';

/** Where the count of teams a pin move would invalidate stands: not asked, being counted, counted, or not countable. */
export type PinImpactState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; impact: PinImpact }
  | { status: 'failed'; error: ApiErrorLike };

export interface PinImpactLoader {
  /** Asks the server; the answer of an earlier, superseded call is dropped. */
  load: (definitionId: string, toVersionNo: number, targets: readonly PinTargetRef[]) => Promise<void>;
  /** Back to idle: a late answer is dropped. */
  reset: () => void;
}

/**
 * The request logic behind `usePinImpact`, apart from React so it can be tested without a renderer. `publish` receives each
 * state in turn. Only the newest call may publish its answer: a call that was superseded by a later `load`, or by `reset`
 * (the dialog closed), finds its turn gone and says nothing.
 */
export function createPinImpactLoader(publish: (state: PinImpactState) => void, f?: FetchLike): PinImpactLoader {
  let latest = 0;
  return {
    async load(definitionId, toVersionNo, targets) {
      const mine = ++latest;
      publish({ status: 'loading' });
      const outcome = await pinImpactRequest(definitionId, toVersionNo, targets, f);
      if (mine !== latest) return;
      publish(outcome.ok ? { status: 'ready', impact: outcome.data } : { status: 'failed', error: outcome.error });
    },
    reset() {
      latest += 1;
      publish({ status: 'idle' });
    },
  };
}

export interface PinImpactControl extends PinImpactLoader {
  state: PinImpactState;
}

/**
 * The state behind the "how many teams would become invalid" line of a pin move's confirmation. Event-driven on purpose, no
 * effect: the dialog opens from a click, the click handler calls `load`, and closing the dialog calls `reset`. The request
 * writes nothing, so a repeated or abandoned call costs only the server's check.
 */
export function usePinImpact(): PinImpactControl {
  const [state, setState] = useState<PinImpactState>({ status: 'idle' });
  const [loader] = useState(() => createPinImpactLoader(setState));
  return { state, load: loader.load, reset: loader.reset };
}
