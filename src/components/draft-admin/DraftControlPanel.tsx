'use client';

/**
 * The admin control panel (draft-frontend §7.1, page §3.4): one tab per pool
 * (Initial draft / Redraft n). The open tab polls its snapshot (3 s, DF2a's
 * `useDraftSnapshot`) and renders the live controls, the blocked-pick
 * resolver, the settings, the pick corrections, the slow-draft penalties and
 * the Redraft manager. Token balances and "Create Redraft" are per season.
 *
 * Every write goes through `AdminDraftActions` (default
 * `createAdminDraftActions`); a success refreshes
 * the snapshot, a rule error applies the snapshot it carries. State holds
 * DTOs and `ApiErrorLike` objects, never translated text.
 *
 * `dataSourceFor` / `actionsFor` / `tokenSource` are test and preview
 * injections (same pattern as `DraftToolClient.dataSource`): `/draft-preview`
 * mounts the panel on an in-memory fake without any network call.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { createHttpDataSource, type ApiCall, type DraftDataSource } from '@/components/draft-tool/data-source';
import type { TokenSource } from '@/components/draft-tokens/token-source';
import { useDraftSnapshot } from '@/components/draft-tool/hooks/use-draft-snapshot';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { PublicPlayerRef } from '@/lib/players/public-player';
import type { AdminPoolSummary, AdminSubmissionDTO, DraftSnapshotDTO } from '@/types/draft-queue';
import { createAdminDraftActions, type AdminDraftActions } from './admin-actions';
import { HINT, InlineError, InlineNotice, PanelCard } from './admin-ui';
import { adminRedraftSlots, poolTabs } from './admin-view';
import BlockedSlotResolver from './BlockedSlotResolver';
import InstanceConfigForm from './InstanceConfigForm';
import LiveControls from './LiveControls';
import PenaltyStageEditor from './PenaltyStageEditor';
import PickCorrectionTable from './PickCorrectionTable';
import RedraftPhaseManager from './RedraftPhaseManager';
import TokenAdminSummary from './TokenAdminSummary';
import { useAdminCall } from './use-admin-call';

export interface DraftControlPanelProps {
  seasonId: string;
  pools: AdminPoolSummary[];
  catalog: DraftLineCatalog;
  /** `toPublicPlayerRef` rows (id + name only). */
  participants: PublicPlayerRef[];
  /** Seeded on the server with `{ tick: false }`; a pool whose read failed is missing (the client polls). */
  initialSnapshots: Record<string, DraftSnapshotDTO>;
  /** `format_rules.comeback_spend_open`. */
  comebackSpendOpen: boolean;
  /** The season has a completed Redraft. */
  hasRedraft: boolean;
  links: { audit: string; room: string };
  /** Preview/test injection; default `createHttpDataSource(poolId, seasonId)`. */
  dataSourceFor?(poolId: string): DraftDataSource;
  /** Preview/test injection; default `createAdminDraftActions(poolId, seasonId)`. */
  actionsFor?(poolId: string): AdminDraftActions;
  /** Passed through to `TokenAdminSummary` (default `createHttpTokenSource(seasonId)`). */
  tokenSource?: TokenSource;
}

export type { AdminDraftActions };

/** The tab that opens first: a running pool (a redraft wins), else the newest. */
function initialTab(pools: readonly AdminPoolSummary[]): string | null {
  const running = [...pools].reverse().find((p) => p.status === 'in_progress');
  return running?.id ?? pools.at(-1)?.id ?? null;
}

async function settle<T>(
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

function PoolPanel({
  pool,
  seasonId,
  catalog,
  initial,
  roomHref,
  dataSourceFor,
  actionsFor,
}: {
  pool: AdminPoolSummary;
  seasonId: string;
  catalog: DraftLineCatalog;
  initial: DraftSnapshotDTO | null;
  roomHref: string;
  dataSourceFor?: DraftControlPanelProps['dataSourceFor'];
  actionsFor?: DraftControlPanelProps['actionsFor'];
}) {
  const t = useT(draftAdminMessages);
  const deadlineFieldId = useId();
  // Created once per mounted pool tab (the panel keys `PoolPanel` by pool id),
  // so an inline `dataSourceFor` does not restart the poll on every render.
  const [source] = useState<DraftDataSource>(() => dataSourceFor?.(pool.id) ?? createHttpDataSource(pool.id, seasonId));
  const [actions] = useState<AdminDraftActions>(
    () => actionsFor?.(pool.id) ?? createAdminDraftActions(pool.id, seasonId),
  );
  const { dto, vm, stale, refresh, applySnapshot, serverOffsetMs } = useDraftSnapshot(source, initial, {
    poolId: pool.id,
    catalog,
  });

  const [submissions, setSubmissions] = useState<AdminSubmissionDTO[] | null>(null);
  const [submissionsError, setSubmissionsError] = useState<ApiErrorLike | null>(null);
  const redraftPhase = vm?.redraft?.phase ?? null;
  const wantsSubmissions = pool.kind === 'redraft' && (redraftPhase === 'submissions' || redraftPhase === 'locked');
  const version = vm?.version ?? null;

  useEffect(() => {
    if (!wantsSubmissions) return;
    let cancelled = false;
    void actions.submissions().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSubmissions(res.data);
        setSubmissionsError(null);
      } else {
        setSubmissionsError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
    // Reloaded whenever the pool's state version moves (a submission bumps it).
  }, [actions, wantsSubmissions, version]);

  const run = useCallback(
    async <T,>(call: Promise<ApiCall<T>>) => (await settle(call, refresh, applySnapshot)).error,
    [refresh, applySnapshot],
  );

  if (!vm || !dto) {
    return <p className={HINT}>{stale ? t('panel.loadFailed') : t('panel.loading')}</p>;
  }

  const blocked = vm.activeSlot?.status === 'blocked';
  const slots = adminRedraftSlots(dto.redraft);

  return (
    <div className="space-y-4">
      {stale ? <InlineError text={t('panel.stale')} /> : null}

      <PanelCard title={t('panel.sections.live')}>
        <LiveControls
          vm={vm}
          catalog={catalog}
          serverOffsetMs={serverOffsetMs}
          makeupSeconds={dto.config.makeup_seconds}
          roomHref={roomHref}
          deadlineHref={`#${deadlineFieldId}`}
          onPause={(paused, reason) => run(actions.pause(paused, reason))}
          onStart={() => run(actions.start())}
          onEnd={(reason) => run(actions.end(reason))}
        />
      </PanelCard>

      {blocked ? (
        <PanelCard title={t('panel.sections.blocked')}>
          <BlockedSlotResolver
            vm={vm}
            catalog={catalog}
            poolKind={pool.kind}
            redraftSlots={slots}
            onResolve={(slotId, input) => run(actions.resolveSlot(slotId, input))}
          />
        </PanelCard>
      ) : null}

      {pool.kind === 'redraft' ? (
        <PanelCard title={t('panel.sections.redraft')}>
          <RedraftPhaseManager
            vm={vm}
            catalog={catalog}
            submissions={submissions}
            submissionsError={submissionsError}
            slots={slots}
            deadlineFieldId={deadlineFieldId}
            nowMs={vm.serverNow}
            onPatchDeadline={(deadline) => run(actions.patchRedraft({ deadline_at: deadline }))}
            onPublish={async (input) => {
              const res = await settle(actions.publishRedraft(input), refresh, applySnapshot);
              return { error: res.error, drops: res.data?.drops ?? 0 };
            }}
            onRestore={(slotId, reason) => run(actions.restoreDrop(slotId, reason))}
          />
        </PanelCard>
      ) : null}

      <PanelCard title={t('panel.sections.settings')}>
        <InstanceConfigForm
          key={pool.id}
          vm={vm}
          dto={dto}
          onSaveConfig={(input) => run(actions.saveConfig(input))}
          onPatchRedraft={(body) => run(actions.patchRedraft(body))}
        />
      </PanelCard>

      <PanelCard title={t('panel.sections.corrections')}>
        <PickCorrectionTable
          vm={vm}
          catalog={catalog}
          onVoid={(pickId, reason, requeue) => run(actions.voidPick(pickId, reason, requeue))}
          onCorrect={(pickId, lineId, reason, requestId, redraftSlotId) =>
            run(actions.correctPick(pickId, lineId, reason, requestId, redraftSlotId))
          }
          onPause={() => run(actions.pause(true))}
        />
      </PanelCard>

      {vm.mode === 'slow' ? (
        <PanelCard title={t('panel.sections.penalties')}>
          <PenaltyStageEditor vm={vm} onSet={(playerId, stage, reason) => run(actions.setPenalty(playerId, stage, reason))} />
        </PanelCard>
      ) : null}
    </div>
  );
}

function CreateRedraft({
  seasonId,
  poolId,
  actionsFor,
}: {
  seasonId: string;
  poolId: string;
  actionsFor?: DraftControlPanelProps['actionsFor'];
}) {
  const t = useT(draftAdminMessages);
  const errorText = useApiErrorText(errorsDraft);
  const router = useRouter();
  const forceId = useId();
  const call = useAdminCall();
  const [open, setOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [created, setCreated] = useState(false);
  const [actions] = useState<AdminDraftActions>(() => actionsFor?.(poolId) ?? createAdminDraftActions(poolId, seasonId));

  const confirm = async () => {
    const ok = await call.run(async () => {
      const res = await actions.createRedraft(force);
      if (res.ok) return null;
      if (res.error.code === 'REDRAFT_NOT_YET_ALLOWED') setNeedsForce(true);
      return res.error;
    });
    if (ok) {
      setOpen(false);
      setCreated(true);
      router.refresh();
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('panel.createRedraft')}
      </Button>
      <InlineNotice text={created ? t('panel.redraftCreated') : null} />
      <ArmedConfirmDialog
        open={open}
        title={t('panel.createRedraftTitle')}
        body={t('panel.createRedraftBody')}
        confirmLabel={t('panel.createRedraft')}
        submitting={call.busy}
        error={call.error ? errorText(call.error) : null}
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          call.clearError();
        }}
      >
        {needsForce ? (
          <div className="space-y-1">
            <p className={HINT}>{t('panel.createRedraftNotYet')}</p>
            <label htmlFor={forceId} className="flex items-center gap-2 text-sm text-poke-text-primary">
              <input id={forceId} type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t('panel.createRedraftForce')}
            </label>
          </div>
        ) : null}
      </ArmedConfirmDialog>
    </div>
  );
}

export default function DraftControlPanel({
  seasonId,
  pools,
  catalog,
  participants,
  initialSnapshots,
  comebackSpendOpen,
  hasRedraft,
  links,
  dataSourceFor,
  actionsFor,
  tokenSource,
}: DraftControlPanelProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const tabs = useMemo(() => poolTabs(pools), [pools]);
  const [active, setActive] = useState<string | null>(() => initialTab(pools));
  const pool = pools.find((p) => p.id === active) ?? null;
  const initialPool = pools.find((p) => p.kind === 'initial') ?? null;
  // BE #28 is season-scoped: with injected actions (tests, preview) the switch goes through them too.
  const actionsPoolId = initialPool?.id ?? pools[0]?.id ?? null;
  const setComebackOpen = useMemo(() => {
    if (!actionsFor || !actionsPoolId) return undefined;
    const actions = actionsFor(actionsPoolId);
    return (open: boolean) => actions.setComebackOpen(open);
  }, [actionsFor, actionsPoolId]);
  const roomHref = pool ? `${links.room}?pool=${encodeURIComponent(pool.id)}` : links.room;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={t('panel.poolTabs')} className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const p = pools.find((x) => x.id === tab.id);
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(tab.id)}
                className={`rounded-poke-md border px-3 py-1.5 text-sm ${
                  selected
                    ? 'border-poke-accent bg-poke-accent text-poke-surface'
                    : 'border-poke-border bg-poke-elevated text-poke-text-primary hover:border-poke-accent'
                }`}
              >
                {tab.kind === 'initial' ? tGlossary('draft.initialDraft') : t('panel.tabRedraft', { n: tab.redraftNo })}
                {p ? <span className="ml-2 text-xs opacity-80">{t(`panel.phase.${p.phase}`)}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={roomHref} className="text-poke-accent hover:underline">
            {t('panel.openRoom')}
          </Link>
          <Link
            href={pool ? `${links.audit}?pool=${encodeURIComponent(pool.id)}` : links.audit}
            className="text-poke-accent hover:underline"
          >
            {tGlossary('draft.auditTrail')}
          </Link>
        </div>
      </div>

      {pool ? (
        <div role="tabpanel">
          <PoolPanel
            key={pool.id}
            pool={pool}
            seasonId={seasonId}
            catalog={catalog}
            initial={initialSnapshots[pool.id] ?? null}
            roomHref={roomHref}
            dataSourceFor={dataSourceFor}
            actionsFor={actionsFor}
          />
        </div>
      ) : (
        <p className={HINT}>{t('page.noPools')}</p>
      )}

      {initialPool ? <CreateRedraft key={initialPool.id} seasonId={seasonId} poolId={initialPool.id} actionsFor={actionsFor} /> : null}

      <PanelCard title={t('panel.sections.tokens')}>
        <TokenAdminSummary
          seasonId={seasonId}
          catalog={catalog}
          participants={participants}
          comebackSpendOpen={comebackSpendOpen}
          hasRedraft={hasRedraft}
          source={tokenSource}
          setComebackOpen={setComebackOpen}
        />
      </PanelCard>
    </div>
  );
}
