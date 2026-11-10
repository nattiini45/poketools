import { defineMachine } from '@/lib/state-machine/machine';
import type { DraftPhase } from '@/types/draft-queue';

/**
 * The lifecycle of one visibility-aware poller (`createVisiblePoller`, `src/lib/draft/use-visible-poll.ts`; AGENTS.md
 * "Live draft screens poll through useVisiblePoll"). Client-only: no row holds it.
 *
 * - `live`: every `liveIntervalMs` (3 s by default) while the tab is visible.
 * - `complete`: every `completeIntervalMs` (at least 60 s), or no timed read when the consumer passes `null`.
 * - `halted`: a tick answered `stop` (401/403; the hidden-tab turn watch also on 404/409; or a consumer's own stop): no
 *   timed read and no refocus read; only `refresh()` revives it.
 * - `stopped`: not started, or stopped by the consumer (unmount, `resetKey` change).
 *
 * A hidden tab is not a state of its own: in `live` and `complete` it only pauses the timer, and the return to the tab
 * reads once. The tick decides between `live` and `complete` (`pollOutcomeForPool` for a draft pool).
 */
export const POLLER_STATES = ['stopped', 'live', 'complete', 'halted'] as const;
export type PollerState = (typeof POLLER_STATES)[number];

const POLLER = 'src/lib/draft/use-visible-poll.ts';
const TICKS = [
  POLLER,
  'src/components/draft-tool/hooks/use-draft-snapshot.ts',
  'src/components/draft/draft-board-sync.ts',
  'src/components/draft-tool/hooks/use-turn-watch.ts',
  'src/components/draft-admin/pool-admin.tsx',
  'src/components/notifications/NotificationBell.tsx',
  'src/components/broadcast/overlays/DraftViewer.tsx',
];

export const pollerMachine = defineMachine({
  id: 'client.visible_poller',
  title: 'Visible poller',
  storage: 'client: createVisiblePoller closure (src/lib/draft/use-visible-poll.ts)',
  summary:
    'One poller per live draft screen (and the notification bell, the OBS draft overlay, the hidden-tab turn watch). A tick reports live, complete or stop; the poller schedules the next read from that. Ticks chain with setTimeout and never overlap.',
  states: POLLER_STATES,
  initial: ['stopped'],
  terminal: [],
  actors: ['consumer', 'tick'],
  transitions: [
    { event: 'start', from: ['stopped'], to: 'live', actors: ['consumer'], writers: [POLLER], note: 'Reads at once, also in a hidden tab.' },
    { event: 'live', from: ['live', 'complete'], to: 'live', actors: ['tick'], writers: TICKS, note: 'Next read after liveIntervalMs.' },
    { event: 'complete', from: ['live', 'complete'], to: 'complete', actors: ['tick'], writers: TICKS, note: 'Next read after completeIntervalMs (>= 60 s), or none when it is null.' },
    { event: 'stop', from: ['live', 'complete'], to: 'halted', actors: ['tick'], writers: TICKS, note: '401/403 (the turn watch also 404/409): asking again cannot help.' },
    { event: 'refresh', from: ['halted'], to: 'live', actors: ['consumer'], writers: [POLLER], note: 'refresh() after a write reads now; the read decides the next state.' },
    { event: 'unmount', from: ['live', 'complete', 'halted'], to: 'stopped', actors: ['consumer'], writers: [POLLER], note: 'Aborts the running tick.' },
  ],
  doc: 'docs/draft-room.md',
});

export type PollOutcome = 'live' | 'complete' | 'stop';

/**
 * The poll outcome of a draft pool: `complete` once the pool is finished, else `live`. A queue pool is read by its
 * phase (`complete` and `cancelled` are finished; both carry the status twin `complete`); a legacy pool, or a
 * response without the phase, by its status. Never pass a legacy pool's phase: the column holds its default `setup`.
 */
export function pollOutcomeForPool(pool: { status: string; phase?: DraftPhase | null }): PollOutcome {
  if (pool.phase) return pool.phase === 'complete' || pool.phase === 'cancelled' ? 'complete' : 'live';
  return pool.status === 'complete' ? 'complete' : 'live';
}
