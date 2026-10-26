'use client';

/**
 * The EPB pick screen container (draft-frontend §3.1, §5): wires the snapshot
 * poll, the search index, favourites, the finder reducer and engine, the
 * stored weakness-stage preference of the roster dock, the clock, the my-turn watch, toasts, the announcer and the pick dialog, and
 * renders `DraftToolScreen`. The host's page header (`header`) goes into the
 * screen as its first row, and above the loading placeholder while there is no
 * snapshot yet, so the page's title never disappears.
 *
 * Pool admins also get the admin sheet (`RoomAdminSheet`, lazy-loaded via
 * `admin-sheet-loader` on first use): it reads this container's one snapshot
 * poll, so an admin in the room never runs a second poller.
 *
 * Server truth wins (SPEC:1113-1121): there is no optimistic taken-state. A
 * pick applies the response's snapshot, then refreshes the poller. State
 * holds keys and data, never translated text (i18n-core §1.7).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { timeMessages } from '@/i18n/messages/time';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { runFinder, type FinderResult } from '@/lib/draft-finder/engine';
import { initialFinderState, type FinderViewState } from '@/lib/draft-finder/filter-types';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import { finderReducer } from '@/lib/draft-finder/reducer';
import { formatCountdown } from '@/lib/draft-ui/clock';
import type { NotifyKind } from '@/lib/draft-ui/notify-schedule';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO, ExtensionKind, LineId, MyTurnDTO } from '@/lib/draft-ui/snapshot-types';
import type { AdminDraftActions } from '@/components/draft-admin/admin-actions';
import type { RoomAdminTab } from '@/components/draft-admin/RoomAdminSheet';
import AdminSheetBoundary, { AdminSheetLoading } from './AdminSheetBoundary';
import { focusAfterAdminSheet } from './admin-focus';
import { loadRoomAdminSheet } from './admin-sheet-loader';
import { createHttpDataSource, type DraftDataSource } from './data-source';
import ConfirmPickDialog from './dialogs/ConfirmPickDialog';
import DraftToast, { type Toast, type ToastLine, type ToastMessage } from './feedback/DraftToast';
import {
  announcedLine,
  announcementsText,
  announcementText,
  diffAnnouncements,
  type Announcement,
} from './feedback/announcements';
import LiveAnnouncer from './feedback/LiveAnnouncer';
import { useClock } from './hooks/use-clock';
import { useDraftSnapshot } from './hooks/use-draft-snapshot';
import { useFavorites } from './hooks/use-favorites';
import { useFinderState, useWeaknessStage } from './hooks/use-finder-state';
import {
  buildPickRequest,
  INITIAL_PICK_FLOW,
  pickFlowReducer,
  runPickSubmission,
  type PickInput,
} from './hooks/pick-flow';
import { useSearchIndex } from './hooks/use-search-index';
import { myTurnRemainingMs, useNotifyPermission, useTurnWatch } from './hooks/use-turn-watch';
import { ctaStateOf } from './left/cta-state';
import { redraftSlotsForPick } from './redraft-slots';
import DraftToolScreen, { type DraftToolLinks } from './DraftToolScreen';
import styles from './draft-tool.module.css';

export interface DraftToolClientProps {
  /**
   * The host page's header (title, group switch, notices). The screen renders it as its first grid row so the
   * desktop screen's fixed height includes it (see `DraftToolScreen`). Omit it when the host renders its own
   * header outside the room and the page scrolls (the dev preview).
   */
  header?: ReactNode;
  poolId: string;
  seasonId: string;
  /**
   * League groups: the pool's group id and display name, for the admin sheet's "Create Redraft" (that group's
   * Redraft). Absent or null in a league without groups.
   */
  seasonGroup?: { id: string; name: string } | null;
  leagueName: string;
  /** One row per list line, narrow (no rationale, history or sources prose). */
  catalog: DraftLineCatalog;
  /** null only if the backend read failed (then the client polls). */
  initialSnapshot: DraftSnapshotDTO | null;
  /** `/api/point-buy-lists/${listVersionId}/search-index?v=…&h=${catalogHash}` */
  indexUrl: string;
  /** Preview only. */
  initialIndex?: DraftSearchIndex;
  /** Display-only flags; the server re-checks every write. */
  viewer: { playerId: string | null; isSiteAdmin: boolean };
  /** Preview injection; default `createHttpDataSource(poolId, seasonId)`. */
  dataSource?: DraftDataSource<DraftSearchIndex>;
  links: DraftToolLinks;
  /**
   * Called once a pick is committed (after the response snapshot is applied).
   * A no-op hook point reserved for the later capture animation (§5.6, SPEC:1177-1191).
   */
  onPickCommitted?(lineId: LineId): void;
  /**
   * Preview only (`/draft-preview` presets): the finder view to start from
   * (filters, pinned line, open filter panel). When set, the view is held
   * here and skips the stored prefs / pinned-line restore and persistence.
   */
  initialView?: Partial<FinderViewState>;
  /** Preview only: open the confirm dialog for this line on the viewer's active slot at mount. */
  initialConfirmLineId?: LineId;
  /** Preview injection for the admin sheet's writes; default `createAdminDraftActions(poolId, seasonId)`. */
  adminActions?: AdminDraftActions;
  /** Preview only: the admin sheet is open at mount (pool admins only), on this tab. */
  initialAdminTab?: RoomAdminTab;
}

/**
 * Code-split: the chunk loads on the first `loadRoomAdminSheet()` call, never for players.
 * `React.lazy` caches a rejected import for good, so Retry after a failed chunk load
 * (`AdminSheetBoundary`) swaps in a fresh lazy component (created in the event handler).
 */
const RoomAdminSheetLazy = lazy(loadRoomAdminSheet);
type LazyRoomAdminSheet = typeof RoomAdminSheetLazy;

const NO_PICK_COMMITTED = (): void => {};

/** Live: "1 minute left"; slow: "1 hour left" — announced once per slot. */
const LIVE_THRESHOLD_MS = 60_000;
const SLOW_THRESHOLD_MS = 3_600_000;

/** One live-region update: `seq` grows with every update, so an unchanged text is read again. */
interface Announced<T> {
  seq: number;
  value: T;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toastLine(entry: DraftLineCatalogEntry | undefined, lineId: LineId): ToastLine {
  return announcedLine(entry, lineId);
}

export default function DraftToolClient({
  header,
  poolId,
  seasonId,
  seasonGroup = null,
  leagueName,
  catalog,
  initialSnapshot,
  indexUrl,
  initialIndex,
  viewer,
  dataSource,
  links,
  onPickCommitted = NO_PICK_COMMITTED,
  initialView,
  initialConfirmLineId,
  adminActions,
  initialAdminTab,
}: DraftToolClientProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tTime = useT(timeMessages);
  const tCommon = useT(commonMessages);
  const f = useFormatter();
  const dl = useDataLocale();

  const source = useMemo<DraftDataSource<DraftSearchIndex>>(
    () => dataSource ?? createHttpDataSource<DraftSearchIndex>(poolId, seasonId),
    [dataSource, poolId, seasonId],
  );
  const byId = useMemo(() => new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l])), [catalog]);
  const entryOf = useCallback((id: LineId) => byId.get(id), [byId]);
  const banned = useMemo(() => new Set(catalog.bannedMoves), [catalog]);

  // ── toasts ──────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keeps the newest three; ids only need to be unique among the shown toasts.
  const pushToast = useCallback((tone: Toast['tone'], message: ToastMessage) => {
    setToasts((list) => [...list.slice(-2), { id: list.reduce((max, x) => Math.max(max, x.id), 0) + 1, tone, message }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const toastError = useCallback((error: ApiErrorLike) => pushToast('error', { kind: 'error', error }), [pushToast]);

  // ── data ────────────────────────────────────────────────────────────
  const snap = useDraftSnapshot(source, initialSnapshot, { poolId, catalog });
  const { vm, dto } = snap;
  const { ix, error: indexError } = useSearchIndex(source, indexUrl, initialIndex);
  const signedIn = (vm?.viewer.playerId ?? viewer.playerId) !== null;
  const { favorites, toggle: toggleFavorite } = useFavorites(source, signedIn, toastError);
  const [storedView, storedDispatch] = useFinderState(poolId);
  // Decided once at mount: a preset view never switches to the stored one (or back).
  const [seeded] = useState(() => initialView !== undefined);
  const [seededView, seededDispatch] = useReducer(finderReducer, initialView, (v) => ({ ...initialFinderState(), ...v }));
  const view = seeded ? seededView : storedView;
  const dispatch = seeded ? seededDispatch : storedDispatch;
  const [weaknessStage, setWeaknessStage] = useWeaknessStage();

  const taken = dto?.taken;
  // Keyed on the fields the finder reads (`FinderQueryView`), not the whole view: picker queries, group and
  // expander toggles of the filter sheet live in the view too and must not re-run the finder per keystroke.
  const { filters, stageMode, tab, sort, sortStage, showDrafted, pinnedLineId } = view;
  const finder: FinderResult | null = useMemo(
    () =>
      ix
        ? runFinder({
            ix,
            catalog,
            view: { filters, stageMode, tab, sort, sortStage, showDrafted, pinnedLineId },
            taken: taken ?? {},
            favorites,
            dataLocale: dl,
            names: pkmnNameResolver,
            banned,
          })
        : null,
    [ix, catalog, filters, stageMode, tab, sort, sortStage, showDrafted, pinnedLineId, taken, favorites, dl, banned],
  );

  const clock = useClock(vm?.activeSlot ?? null, vm?.serverNow ?? 0, snap.serverOffsetMs);

  // ── turn alerts ─────────────────────────────────────────────────────
  const { state: notify, toggle: toggleNotify } = useNotifyPermission(poolId);
  const me = vm?.participants.find((p) => p.isViewer);
  const watchEnabled =
    vm !== null && vm.viewer.isParticipant && me !== undefined && !me.done && (vm.status === 'pending' || vm.status === 'in_progress');
  const fetchMyTurn = useCallback((signal: AbortSignal) => source.fetchMyTurn(signal), [source]);
  const buildAlert = useCallback(
    (kind: NotifyKind, turn: MyTurnDTO) => {
      const remaining = myTurnRemainingMs(turn) ?? 0;
      const time = formatCountdown(remaining, turn.mode, f, tShared);
      return {
        title: t('notify.turnTitle', { league: turn.league_name || leagueName }),
        body: kind === 'turn' ? t('notify.turnBody', { time }) : t('notify.remindBody', { time }),
      };
    },
    [f, t, tShared, leagueName],
  );
  useTurnWatch({ fetchMyTurn, enabled: watchEnabled, poolId, buildAlert });

  // ── admin override (resets when the active slot changes, §5.10) ────
  const [adminOverride, setAdminOverride] = useState(false);
  const [overrideSlot, setOverrideSlot] = useState<string | null>(vm?.activeSlot?.slot_id ?? null);
  const activeSlotId = vm?.activeSlot?.slot_id ?? null;
  if (activeSlotId !== overrideSlot) {
    setOverrideSlot(activeSlotId);
    if (adminOverride) setAdminOverride(false);
  }

  // ── admin sheet (pool admins only, §7.1 in the room) ───────────────
  // Mounted (and its chunk requested) on first open; kept mounted afterwards so Radix can close it.
  const isPoolAdmin = vm?.viewer.isPoolAdmin === true;
  const [adminOpen, setAdminOpen] = useState(initialAdminTab !== undefined);
  const [adminMounted, setAdminMounted] = useState(initialAdminTab !== undefined);
  // Bumped by Retry after a failed chunk load: a fresh lazy component requests the chunk again.
  const [adminAttempt, setAdminAttempt] = useState(0);
  const [RoomAdminSheet, setRoomAdminSheet] = useState<LazyRoomAdminSheet>(() => RoomAdminSheetLazy);
  const retryAdmin = useCallback(() => {
    setRoomAdminSheet(() => lazy(loadRoomAdminSheet));
    setAdminAttempt((n) => n + 1);
  }, []);
  const dismissAdmin = useCallback(() => {
    setAdminOpen(false);
    setAdminMounted(false);
  }, []);
  const adminSwitchRef = useRef<HTMLInputElement>(null);
  const focusSwitchOnClose = useRef(false);
  const openAdmin = useCallback(() => {
    setAdminMounted(true);
    setAdminOpen(true);
  }, []);
  const prefetchAdmin = useCallback(() => {
    // A failed prefetch (stale chunk, offline) is logged here; the click path reports it through the boundary.
    loadRoomAdminSheet().catch((error: unknown) => {
      console.error('[draft-room] admin sheet prefetch failed', error);
    });
  }, []);
  const onPickForActive = useCallback(() => {
    focusSwitchOnClose.current = true;
    setAdminOverride(true);
  }, []);
  const onAdminCloseAutoFocus = useCallback((event: Event) => {
    focusAfterAdminSheet(event, focusSwitchOnClose, adminSwitchRef.current);
  }, []);

  // ── announcements (derived from snapshot changes during render) ────
  // One poll can bring several polite announcements (a pick always moves the clock): all are kept.
  const [seenVm, setSeenVm] = useState<DraftViewModel | null>(vm);
  const [polite, setPolite] = useState<Announced<Announcement[]>>({ seq: 0, value: [] });
  const [assertive, setAssertive] = useState<Announced<Announcement | null>>({ seq: 0, value: null });
  const [thresholdSlot, setThresholdSlot] = useState<string | null>(null);
  if (vm !== seenVm) {
    setSeenVm(vm);
    if (seenVm && vm && vm.version !== seenVm.version) {
      const d = diffAnnouncements(seenVm, vm, entryOf);
      if (d.polite.length > 0) setPolite((p) => ({ seq: p.seq + 1, value: d.polite }));
      const nextAssertive = d.assertive;
      if (nextAssertive) setAssertive((a) => ({ seq: a.seq + 1, value: nextAssertive }));
      if (d.yourTurn) pushToast('info', { kind: 'yourTurn' });
    }
  }
  const thresholdMs = vm?.mode === 'slow' ? SLOW_THRESHOLD_MS : LIVE_THRESHOLD_MS;
  if (vm?.viewerOnClock && clock && !clock.paused && clock.remainingMs > 0 && clock.remainingMs <= thresholdMs && thresholdSlot !== activeSlotId) {
    setThresholdSlot(activeSlotId);
    const kind = vm.mode === 'slow' ? 'oneHour' : 'oneMinute';
    setAssertive((a) => ({ seq: a.seq + 1, value: { kind } }));
  }
  const announceDeps = { t, tTime, names: pkmnNameResolver, dl };

  // ── pick flow (§5.6) ────────────────────────────────────────────────
  const [flow, flowDispatch] = useReducer(pickFlowReducer, INITIAL_PICK_FLOW, (initial) => {
    const slotId = vm?.activeSlot?.slot_id;
    if (!initialConfirmLineId || !slotId) return initial;
    return pickFlowReducer(initial, {
      type: 'open',
      requestId: newRequestId(),
      target: { slotId, lineId: initialConfirmLineId, onBehalfOf: null },
    });
  });
  const draftButtonRef = useRef<HTMLButtonElement>(null);
  const draftBarButtonRef = useRef<HTMLButtonElement>(null);
  // Focus returns to whichever DRAFT button is shown: the stage one, or the phone bottom bar's.
  const focusDraftButton = useCallback(() => {
    const visible = [draftButtonRef.current, draftBarButtonRef.current].find((el) => el !== null && el.offsetParent !== null);
    (visible ?? draftButtonRef.current)?.focus();
  }, []);
  const pinnedEntry = view.pinnedLineId ? byId.get(view.pinnedLineId) : undefined;

  const onDraft = useCallback(() => {
    if (!vm || !pinnedEntry || !vm.activeSlot) return;
    const cta = ctaStateOf(vm, { lineId: pinnedEntry.lineId, price: pinnedEntry.price }, adminOverride);
    if (!cta.enabled) return;
    flowDispatch({
      type: 'open',
      requestId: newRequestId(),
      target: { slotId: vm.activeSlot.slot_id, lineId: pinnedEntry.lineId, onBehalfOf: cta.target },
    });
  }, [vm, pinnedEntry, adminOverride]);

  const onConfirm = useCallback(
    (input: PickInput) => {
      if (!flow.target || !flow.requestId || flow.submitting) return;
      const target = flow.target;
      flowDispatch({ type: 'submit' });
      const body = buildPickRequest(target, flow.requestId, input);
      const entry = byId.get(target.lineId);
      void runPickSubmission(
        {
          postPick: (b) => source.postPick(b),
          applySnapshot: snap.applySnapshot,
          refresh: snap.refresh,
          onSettled: (outcome) => {
            if (outcome.kind === 'success') {
              flowDispatch({ type: 'succeeded' });
              onPickCommitted(target.lineId);
              const line = toastLine(entry, target.lineId);
              pushToast(
                'success',
                target.onBehalfOf ? { kind: 'addedFor', line, player: target.onBehalfOf.name } : { kind: 'added', line },
              );
              setTimeout(focusDraftButton, 0);
            } else if (outcome.kind === 'closed') {
              flowDispatch({ type: 'failed', error: outcome.error, close: true });
              toastError(outcome.error);
            } else {
              flowDispatch({ type: 'failed', error: outcome.error, close: false });
            }
          },
        },
        body,
      );
    },
    [
      flow.target,
      flow.requestId,
      flow.submitting,
      byId,
      source,
      snap.applySnapshot,
      snap.refresh,
      pushToast,
      toastError,
      focusDraftButton,
      onPickCommitted,
    ],
  );

  // ── extensions ──────────────────────────────────────────────────────
  const [extensionBusy, setExtensionBusy] = useState(false);
  const onExtension = useCallback(
    (kind: ExtensionKind) => {
      const slotId = vm?.activeSlot?.slot_id;
      if (!slotId || extensionBusy) return;
      setExtensionBusy(true);
      void source.postExtension(kind, slotId).then(async (res) => {
        if (!res.ok) toastError(res.error);
        await snap.refresh();
        setExtensionBusy(false);
      });
    },
    [vm, extensionBusy, source, snap, toastError],
  );

  // ── in-app turn state: tab title prefix while on the clock (§5.8) ──
  const onClock = vm?.viewerOnClock ?? false;
  useEffect(() => {
    if (!onClock) return;
    // i18n-ignore: a status glyph, not text
    const prefix = '● ';
    if (!document.title.startsWith(prefix)) document.title = `${prefix}${document.title}`;
    return () => {
      // Strip only the prefix, so a title change made meanwhile (navigation, another tab state) survives.
      if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length);
    };
  }, [onClock]);

  if (!vm) {
    return (
      <div className="flex flex-col gap-3">
        {header ? <div className={styles.screenHeader}>{header}</div> : null}
        <div className={`${styles.root} rounded-xl border border-[var(--draft-border)] p-8 text-center text-[var(--draft-ink-2)]`} role="status">
          {snap.stale ? t('page.loadFailed') : tCommon('states.loading')}
        </div>
      </div>
    );
  }

  const flowEntry = flow.target ? byId.get(flow.target.lineId) : undefined;
  const flowRemaining =
    flowEntry && flow.target
      ? flow.target.onBehalfOf
        ? (() => {
            const p = vm.participants.find((x) => x.player_id === flow.target?.onBehalfOf?.playerId);
            return p ? p.budget_remaining - flowEntry.price : null;
          })()
        : vm.viewer.budgetRemaining === null
          ? null
          : vm.viewer.budgetRemaining - flowEntry.price
      : null;
  // An on-behalf pick fills one of the ACTIVE player's Redraft slots, not the admin's own.
  const redraftSlots = redraftSlotsForPick(vm.kind, vm.viewer.redraftSlots, dto?.redraft, flow.target?.onBehalfOf?.playerId ?? null);

  return (
    <>
      <DraftToolScreen
        header={header}
        vm={vm}
        catalog={catalog}
        finder={finder}
        view={view}
        dispatch={dispatch}
        favorites={favorites}
        clock={clock}
        notify={notify}
        onNotifyToggle={toggleNotify}
        onDraft={onDraft}
        onExtension={onExtension}
        onToggleFavorite={toggleFavorite}
        onAdminOverride={setAdminOverride}
        adminOverride={adminOverride}
        links={links}
        ix={ix}
        stale={snap.stale}
        authBlocked={snap.authBlocked}
        makeupSeconds={dto?.config.makeup_seconds ?? null}
        extensionBusy={extensionBusy}
        draftButtonRef={draftButtonRef}
        draftBarButtonRef={draftBarButtonRef}
        indexFailed={indexError !== null && ix === null}
        weaknessStage={weaknessStage}
        onWeaknessStage={setWeaknessStage}
        canFavorite={signedIn}
        onOpenAdmin={isPoolAdmin ? openAdmin : undefined}
        onPrefetchAdmin={isPoolAdmin ? prefetchAdmin : undefined}
        adminOpen={adminOpen}
        adminSwitchRef={adminSwitchRef}
      />
      {isPoolAdmin && adminMounted && dto ? (
        <AdminSheetBoundary key={adminAttempt} onRetry={retryAdmin} onDismiss={dismissAdmin}>
          <Suspense fallback={adminOpen ? <AdminSheetLoading /> : null}>
          <RoomAdminSheet
            open={adminOpen}
            onOpenChange={setAdminOpen}
            poolId={poolId}
            seasonId={seasonId}
            seasonGroupId={seasonGroup?.id ?? null}
            seasonGroupName={seasonGroup?.name ?? null}
            catalog={catalog}
            snap={{
              vm,
              dto,
              serverOffsetMs: snap.serverOffsetMs,
              stale: snap.stale,
              refresh: snap.refresh,
              applySnapshot: snap.applySnapshot,
            }}
            links={{ control: links.admin, audit: links.adminAudit }}
            onPickForActive={onPickForActive}
            onCloseAutoFocus={onAdminCloseAutoFocus}
            actions={adminActions}
            initialTab={initialAdminTab}
          />
          </Suspense>
        </AdminSheetBoundary>
      ) : null}
      {flowEntry ? (
        <ConfirmPickDialog
          key={flow.openCount}
          open={flow.open}
          onCancel={() => flowDispatch({ type: 'cancel' })}
          entry={flowEntry}
          price={flowEntry.price}
          remainingAfter={flowRemaining}
          redraftSlots={redraftSlots}
          adminOverride={flow.target?.onBehalfOf ? { targetName: flow.target.onBehalfOf.name } : null}
          submitting={flow.submitting}
          error={flow.error}
          retryable={flow.retryable}
          onConfirm={onConfirm}
          entryOf={entryOf}
        />
      ) : null}
      <DraftToast toasts={toasts} onDismiss={dismissToast} />
      <LiveAnnouncer
        polite={announcementsText(polite.value, announceDeps)}
        politeKey={polite.seq}
        assertive={assertive.value ? announcementText(assertive.value, announceDeps) : ''}
        assertiveKey={assertive.seq}
      />
    </>
  );
}
