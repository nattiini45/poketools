'use client';

/**
 * The per-pool admin sections (draft-frontend §7.1), shared by the control
 * page (`DraftControlPanel`, every section stacked in a card) and the draft
 * room's admin sheet (`RoomAdminSheet`, one section per tab).
 *
 * The sections never poll the snapshot: they read the one they are given
 * (`PoolAdminSnapshot`). The control page feeds them from its own
 * `useDraftSnapshot` per pool tab; the draft room feeds them from the room's
 * one poller (`DraftToolClient`), so an admin in the room runs a single
 * snapshot poll. The Redraft section's own read (submissions and the refused
 * automatic publish) is described at `redraftSubmissionsRead`.
 *
 * Every write goes through `AdminDraftActions`: a success refreshes the
 * snapshot, a rule error applies the snapshot it carries (`settle`).
 */
import { useCallback, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { ApiCall } from '@/components/draft-tool/data-source';
import { useVisiblePoll, type PollOutcome } from '@/lib/draft/use-visible-poll';
import type { AdminRedraftSubmissionsDTO, DraftSnapshotDTO } from '@/types/draft-queue';
import type { AdminDraftActions } from './admin-actions';
import { adminRedraftSlots } from './admin-view';
import InstanceConfigForm from './InstanceConfigForm';
import LiveControls, { type DeadlineTarget, type PickForTarget } from './LiveControls';
import PenaltyStageEditor from './PenaltyStageEditor';
import PickCorrectionTable from './PickCorrectionTable';
import RedraftPhaseManager from './RedraftPhaseManager';
import type { AdminResult } from './use-admin-call';

/** What the sections read and how they refresh: the shape of `useDraftSnapshot` with the snapshot loaded. */
export interface PoolAdminSnapshot {
  vm: DraftViewModel;
  dto: DraftSnapshotDTO;
  serverOffsetMs: number;
  refresh(): Promise<void>;
  applySnapshot(dto: DraftSnapshotDTO): void;
}

export type PoolAdminSection = 'live' | 'picks' | 'settings' | 'redraft' | 'penalties';

/**
 * The sections a pool has, in the room sheet's tab order: Redraft only for a
 * Redraft pool, Penalties only in slow mode.
 */
export function poolAdminSections(vm: Pick<DraftViewModel, 'kind' | 'mode'>): PoolAdminSection[] {
  const out: PoolAdminSection[] = ['live', 'picks', 'settings'];
  if (vm.kind === 'redraft') out.push('redraft');
  if (vm.mode === 'slow') out.push('penalties');
  return out;
}

/** One admin write: refresh on success, apply the carried snapshot on a rule error. */
export async function settle<T>(
  call: Promise<ApiCall<T>>,
  refresh: () => Promise<void>,
  applySnapshot: (dto: DraftSnapshotDTO) => void,
): Promise<{ error: ApiErrorLike | null; data: T | null }> {
  const res = await call;
  if (res.ok) {
    await refresh();
    return { error: null, data: res.data };
  }
  if (res.snapshot) applySnapshot(res.snapshot);
  return { error: res.error, data: null };
}

/** `run(call)` for the section callbacks: the error object or null. */
export function usePoolAdminRun(snap: Pick<PoolAdminSnapshot, 'refresh' | 'applySnapshot'>) {
  const { refresh, applySnapshot } = snap;
  return useCallback(
    async <T,>(call: Promise<ApiCall<T>>): AdminResult => (await settle(call, refresh, applySnapshot)).error,
    [refresh, applySnapshot],
  );
}

/**
 * How the Redraft section reads `GET …/redraft/submissions` (BE #20: every player's drop list plus the
 * refused automatic publish):
 * - only for a Redraft that collects or holds drops (`submissions` / `locked`);
 * - again whenever the pool's state version or phase moves (a submission, a deadline change, the deadline
 *   passing);
 * - while `locked` (the deadline passed, nothing published yet) once a minute as well: the deadline tick's
 *   refusal (`draft_pools.publish_refused_at`) does not bump the state version, so the version alone would
 *   never show it. This is the only timed read of the sections; it pauses in a hidden tab (`useVisiblePoll`).
 */
export const REFUSAL_WATCH_MS = 60_000;

export function redraftSubmissionsRead(vm: Pick<DraftViewModel, 'kind' | 'redraft' | 'version'>): {
  enabled: boolean;
  /** Re-read on a timer (`REFUSAL_WATCH_MS`), not only on a state change. */
  watch: boolean;
  /** A change restarts the read (the pool's state version and the Redraft phase). */
  key: string;
} {
  const phase = vm.redraft?.phase ?? null;
  const enabled = vm.kind === 'redraft' && (phase === 'submissions' || phase === 'locked');
  return { enabled, watch: enabled && phase === 'locked', key: `${vm.version}:${phase ?? ''}` };
}

/**
 * The Redraft submissions and refusal, per `redraftSubmissionsRead`. Only mounted with the Redraft section,
 * so the room sheet reads them when its Redraft tab opens, never in the room's render.
 */
function useRedraftSubmissions(actions: AdminDraftActions, vm: DraftViewModel) {
  const [data, setData] = useState<AdminRedraftSubmissionsDTO | null>(null);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const { enabled, watch, key } = redraftSubmissionsRead(vm);

  const tick = useCallback(
    async (signal: AbortSignal): Promise<PollOutcome> => {
      const res = await actions.submissions();
      if (signal.aborted) return 'stop';
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
      // 'complete' with `completeIntervalMs: null` = no timed re-read (a tab refocus still reads once).
      return watch ? 'live' : 'complete';
    },
    [actions, watch],
  );
  useVisiblePoll(tick, { enabled, liveIntervalMs: REFUSAL_WATCH_MS, completeIntervalMs: null, resetKey: key });

  return { submissions: data?.submissions ?? null, publishRefusedAt: data ? data.publish_refused_at : undefined, error };
}

/**
 * The refusal the Redraft section shows: the section's own read once it answered (the fresher value; null =
 * never refused); before that, the value the control page's server render passed (`publishRefusedAt`, absent
 * in the room). The column is only ever set (a later refusal moves it), so the read never takes a notice away
 * that the server render showed for the same pool.
 */
export function shownPublishRefusal(read: string | null | undefined, server: string | null | undefined): string | null {
  return read !== undefined ? read : (server ?? null);
}

export interface PoolAdminSectionProps {
  section: PoolAdminSection;
  snap: PoolAdminSnapshot;
  actions: AdminDraftActions;
  catalog: DraftLineCatalog;
  /** Id of the Redraft deadline field (rendered by the Redraft section). */
  deadlineFieldId: string;
  /** Live section: where "Pick for the active player" goes. */
  pickFor: PickForTarget;
  /** Live section: where "Edit the deadline" goes. */
  deadline: DeadlineTarget;
  /** Live section: show the read-only clock bar (off in the room, which has its own). */
  showClock?: boolean;
  /**
   * Redraft section: `draft_pools.publish_refused_at` as the control page's server render read it (admin data).
   * Shown until the section's own submissions read answers; from then on that read's `publish_refused_at` wins.
   * The room's sheet passes nothing: its Redraft tab shows the refusal from that read.
   */
  publishRefusedAt?: string | null;
}

function RedraftSection({
  snap,
  actions,
  catalog,
  deadlineFieldId,
  publishRefusedAt,
}: Omit<PoolAdminSectionProps, 'section' | 'pickFor' | 'deadline' | 'showClock'>) {
  const { vm, dto, refresh, applySnapshot } = snap;
  const run = usePoolAdminRun(snap);
  const loaded = useRedraftSubmissions(actions, vm);
  const { submissions, error } = loaded;
  const refusedAt = shownPublishRefusal(loaded.publishRefusedAt, publishRefusedAt);
  return (
    <RedraftPhaseManager
      vm={vm}
      catalog={catalog}
      submissions={submissions}
      submissionsError={error}
      slots={adminRedraftSlots(dto.redraft)}
      deadlineFieldId={deadlineFieldId}
      nowMs={vm.serverNow}
      onPatchDeadline={(deadline) => run(actions.patchRedraft({ deadline_at: deadline }))}
      onPublish={async (input) => {
        const res = await settle(actions.publishRedraft(input), refresh, applySnapshot);
        return { error: res.error, drops: res.data?.drops ?? 0 };
      }}
      onRestore={(slotId, reason) => run(actions.restoreDrop(slotId, reason))}
      publishRefusedAt={refusedAt}
    />
  );
}

/** One admin section of a pool, without a card or heading (the caller frames it). */
export function PoolAdminSectionView(props: PoolAdminSectionProps) {
  const { section, snap, actions, catalog, pickFor, deadline, showClock = true } = props;
  const { vm, dto, serverOffsetMs } = snap;
  const run = usePoolAdminRun(snap);

  switch (section) {
    case 'live':
      return (
        <LiveControls
          vm={vm}
          catalog={catalog}
          serverOffsetMs={serverOffsetMs}
          makeupSeconds={dto.config.makeup_seconds}
          pickFor={pickFor}
          deadline={deadline}
          showClock={showClock}
          onPause={(paused, reason) => run(actions.pause(paused, reason))}
          onStart={() => run(actions.start())}
          onEnd={(reason) => run(actions.end(reason))}
        />
      );
    case 'redraft':
      return (
        <RedraftSection
          snap={snap}
          actions={actions}
          catalog={catalog}
          deadlineFieldId={props.deadlineFieldId}
          publishRefusedAt={props.publishRefusedAt}
        />
      );
    case 'settings':
      return (
        <InstanceConfigForm
          key={dto.pool.id}
          vm={vm}
          dto={dto}
          onSaveConfig={(input) => run(actions.saveConfig(input))}
          onPatchRedraft={(body) => run(actions.patchRedraft(body))}
        />
      );
    case 'picks':
      return (
        <PickCorrectionTable
          vm={vm}
          catalog={catalog}
          onVoid={(pickId, reason) => run(actions.voidPick(pickId, reason))}
          onCorrect={(pickId, lineId, reason, requestId, redraftSlotId) =>
            run(actions.correctPick(pickId, lineId, reason, requestId, redraftSlotId))
          }
          onPause={() => run(actions.pause(true))}
        />
      );
    case 'penalties':
      return <PenaltyStageEditor vm={vm} onSet={(playerId, stage, reason) => run(actions.setPenalty(playerId, stage, reason))} />;
  }
}
