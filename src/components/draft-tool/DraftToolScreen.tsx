'use client';

/**
 * The EPB pick screen layout (draft-frontend §5.3, §5.5): the host's page
 * header (`header`), the clock bar and order strip on top; the left stage (a one-line status strip, info box, why it
 * matches, the line as one group portrait of its stages, the budget left after
 * the pick with the DRAFT button, roster dock with its team weakness overview,
 * last picks, compare); the roster wall on the right with the finder.
 * Presentational apart from local
 * UI state (players sheet, hover intent): it never fetches, and every write
 * goes through the callbacks of `DraftToolClient`.
 *
 * The price shows once, in the info box title. The budget left after the pick
 * sits above the DRAFT button (the phone bottom bar carries it instead of the
 * dock) and, for an admin picking on behalf, names the player it belongs to.
 *
 * Phones get the §5.3 order (header → clock → selected card → wall →
 * roster/picks/compare) and a sticky bottom bar with the budget left and the
 * DRAFT button; desktop the diagonal split.
 *
 * From 1024 px the screen is a box of fixed height (the viewport minus the nav
 * and the layout's padding) and the page header is its first grid row, so the
 * document itself never scrolls: only the left column (`stageScroll`, inside
 * the diagonal frame `stagePane`) and the roster grid do. Below 1024 px the
 * page scrolls and the header simply flows first.
 *
 * Pool admins get an Admin button in the clock row (`onOpenAdmin`); the
 * admin sheet itself is owned and lazy-loaded by `DraftToolClient`.
 *
 * The wall: finder bar, the chip row (always rendered, "No filters" when
 * empty, the one place the match count shows), then the price tabs pinned on top (sticky under
 * the site nav while the page scrolls, a fixed row from 1024 px), then the card
 * grid, which is the scroll container from 1024 px. `useStickyOffsets` measures
 * the nav, the clock row and the DRAFT dock (the stage card is capped above it). The filters open in a
 * portalled side sheet (`FilterPanel`), outside the wall pane.
 */
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { useDataLocale, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { compileCriteria, evaluateLine, type FinderResult, type LineEvaluation } from '@/lib/draft-finder/engine';
import { buildChips } from '@/lib/draft-finder/chips';
import { hasActiveFilters, type FinderAction, type FinderViewState, type SortStage } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { countByTab, PRICE_TAB_KEYS, tabOf, type PriceTabKey } from '@/lib/draft-finder/tabs';
import type { ClockView } from '@/lib/draft-ui/clock';
import { reasonText } from '@/lib/draft-ui/reasons';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { ExtensionKind, LineId } from '@/lib/draft-ui/snapshot-types';
import { useHoverIntent } from './hooks/use-hover-intent';
import { useStickyOffsets } from './hooks/use-sticky-offsets';
import type { NotifyState } from './hooks/use-turn-watch';
import ClockBar from './layout/ClockBar';
import PhoneSection from './layout/PhoneSection';
import PlayersSheet from './layout/PlayersSheet';
import UpcomingOrderStrip from './layout/UpcomingOrderStrip';
import CompareTray from './left/CompareTray';
import CostConsequence, { RemainingAfterPick } from './left/CostConsequence';
import { ctaStateOf, type CtaState } from './left/cta-state';
import DraftButton from './left/DraftButton';
import InfoBox from './left/InfoBox';
import LinePreview from './left/LinePreview';
import MatchExplanation from './left/MatchExplanation';
import MyRosterDock, { rosterCounts } from './left/MyRosterDock';
import RecentPicks from './left/RecentPicks';
import StageStatus from './left/StageStatus';
import ActiveFilterChips from './right/ActiveFilterChips';
import FilterPanel, { filterTriggerId } from './right/FilterPanel';
import FinderBar from './right/FinderBar';
import HoverDetails from './right/HoverDetails';
import PriceTabs from './right/PriceTabs';
import { criterionLabel, useFinderLabelContext, type CriterionLabel } from './right/finder-labels';
import RosterWall from './right/RosterWall';
import styles from './draft-tool.module.css';

export interface DraftToolLinks {
  redraft: string;
  tokens: string;
  /** The league's full draft control page (pool admins only; linked from the room's admin sheet). */
  admin: string | null;
  /** The league's draft audit trail (pool admins only; linked from the room's admin sheet). */
  adminAudit: string | null;
  trainerCreator: string;
}

export interface DraftToolScreenProps {
  /**
   * The host page's header (title, group switch, notices), rendered as the screen's first row so that its
   * height is part of the screen's fixed desktop height instead of an unmeasured term above it. Omit it when
   * the host keeps its header outside the screen and lets the page scroll (the dev preview).
   */
  header?: ReactNode;
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  finder: FinderResult | null;
  view: FinderViewState;
  dispatch: Dispatch<FinderAction>;
  favorites: ReadonlySet<LineId>;
  clock: ClockView | null;
  notify: NotifyState;
  onNotifyToggle(): void;
  onDraft(): void;
  onExtension(kind: ExtensionKind): void;
  onToggleFavorite(lineId: LineId): void;
  onAdminOverride?(on: boolean): void;
  adminOverride: boolean;
  links: DraftToolLinks;
  /** The prepared search index; null while it loads (filters disabled). */
  ix: PreparedIndex | null;
  /** The search index failed to load: the filters stay disabled, and the wall says why. */
  indexFailed?: boolean;
  /** The stage (Base | Final) the team weakness overview under "My roster" reads; a persisted preference. */
  weaknessStage: SortStage;
  onWeaknessStage(stage: SortStage): void;
  /** The overview starts expanded (preview scenarios); collapsed by default. */
  weaknessOpen?: boolean;
  /** The last poll failed: showing the last state. */
  stale?: boolean;
  /** The poll answered 401/403 (spectator mode). */
  authBlocked?: boolean;
  /** `config.makeup_seconds` for the order strip. */
  makeupSeconds?: number | null;
  extensionBusy?: boolean;
  /** Focus returns here after a pick (the stage button, tablet and desktop). */
  draftButtonRef?: Ref<HTMLButtonElement>;
  /** The phone bottom bar's DRAFT button; the client focuses whichever is visible. */
  draftBarButtonRef?: Ref<HTMLButtonElement>;
  /** Favourites need a signed-in viewer. */
  canFavorite?: boolean;
  /** Pool admins only: opens the admin sheet (the clock row's Admin button). */
  onOpenAdmin?(): void;
  /** Starts loading the admin sheet's code (hover/focus on the Admin button). */
  onPrefetchAdmin?(): void;
  /** The admin sheet is open. */
  adminOpen?: boolean;
  /** The admin override switch; focus lands here after the sheet's "Pick for the active player". */
  adminSwitchRef?: Ref<HTMLInputElement>;
}

export default function DraftToolScreen({
  header,
  vm,
  catalog,
  finder,
  view,
  dispatch,
  favorites,
  clock,
  notify,
  onNotifyToggle,
  onDraft,
  onExtension,
  onToggleFavorite,
  onAdminOverride,
  adminOverride,
  links,
  ix,
  indexFailed = false,
  weaknessStage,
  onWeaknessStage,
  weaknessOpen = false,
  stale = false,
  authBlocked = false,
  makeupSeconds = null,
  extensionBusy = false,
  draftButtonRef,
  draftBarButtonRef,
  canFavorite = true,
  onOpenAdmin,
  onPrefetchAdmin,
  adminOpen = false,
  adminSwitchRef,
}: DraftToolScreenProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const labelCtx = useFinderLabelContext(pkmnNameResolver);
  const dl = useDataLocale();
  const headingId = useId();
  const filterPanelId = useId();
  const wallId = useId();
  const barReasonId = useId();
  const [playersOpen, setPlayersOpen] = useState(false);
  const { intent: hover, onHover } = useHoverIntent<{ lineId: LineId; anchor: HTMLElement | null }>();
  const rootRef = useRef<HTMLDivElement>(null);
  const clockRowRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wallScrollRef = useRef<HTMLDivElement>(null);
  useStickyOffsets(rootRef, clockRowRef, dockRef);

  // A new price tab starts at the top of the grid (desktop scroller; below 1024 px the page scrolls and the
  // tabs stay where they are). Filters and the pinned line are untouched (SPEC:196-199).
  useEffect(() => {
    if (wallScrollRef.current) wallScrollRef.current.scrollTop = 0;
  }, [view.tab]);

  const byId = useMemo(() => new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l])), [catalog]);
  const banned = useMemo(() => new Set(catalog.bannedMoves), [catalog]);
  const pinned = view.pinnedLineId ? (byId.get(view.pinnedLineId) ?? null) : null;

  const cta: CtaState = ctaStateOf(vm, pinned ? { lineId: pinned.lineId, price: pinned.price } : null, adminOverride);
  const ctaReason =
    cta.block === null
      ? null
      : cta.block.kind === 'select'
        ? t('cta.selectFirst')
        : cta.block.kind === 'noActive'
          ? t('cta.activeOnly')
          : reasonText(tShared, cta.block.reason, vm);
  const showAdminToggle = vm.viewer.isPoolAdmin && vm.activeSlot !== null && !vm.activeSlot.isViewer && vm.status === 'in_progress';
  const spectator = vm.viewer.playerId === null || authBlocked ? 'guest' : !vm.viewer.isParticipant ? 'nonParticipant' : null;
  // Budget left after the pick: a spectator has none of their own, and an admin picking on behalf sees the
  // active player's, labelled with the name.
  const remainingAfter = spectator !== null && cta.variant === 'player' ? null : cta.remainingAfter;
  const remainingFor = cta.variant === 'admin' ? (cta.target?.name ?? null) : null;

  // The active criteria's labels for the compare tray (the pinned line's explanation labels its own rows).
  const pinnedEvaluation = finder?.pinnedEvaluation ?? null;
  const criteria: CriterionLabel[] = (pinnedEvaluation?.results ?? finder?.rows[0]?.evaluation.results ?? []).map((r) => ({
    id: r.criterionId,
    label: criterionLabel(r.criterionId, view.filters, ix, labelCtx),
  }));
  const visibleInResults = finder === null || pinned === null || finder.rows.some((r) => r.lineId === pinned.lineId);
  // "Not in the current price tab" only when the tab is the one reason: the line matches, it sits in another
  // tab, and it is not hidden for being drafted while "show drafted" is off.
  const hiddenByTab =
    !visibleInResults &&
    pinned !== null &&
    pinnedEvaluation !== null &&
    pinnedEvaluation.matches &&
    view.tab !== 'all' &&
    tabOf(pinned.price) !== view.tab &&
    (view.showDrafted || vm.takenBy[pinned.lineId] === undefined);

  const filtersActive = hasActiveFilters(view.filters);
  // The price tabs render before the search index loads (and after it fails): totals then come from the
  // catalog alone, without matching/total, so the tab strip never pops in above the wall.
  const catalogTabCounts = useMemo<FinderResult['tabCounts']>(() => {
    const totals = countByTab(
      catalog.lines.map((l) => l.lineId),
      (id) => byId.get(id)?.price ?? 0,
    );
    return Object.fromEntries(PRICE_TAB_KEYS.map((k) => [k, { matching: totals[k], total: totals[k] }])) as Record<
      PriceTabKey,
      { matching: number; total: number }
    >;
  }, [catalog, byId]);
  // Wall rows carry their evaluation; compared lines outside the current tab or filter are evaluated here,
  // so the tray never shows ✕ for a line it merely has no row for.
  const evaluations = useMemo(() => {
    const map = new Map<LineId, LineEvaluation>((finder?.rows ?? []).map((r) => [r.lineId, r.evaluation]));
    const missing = view.compareLineIds.filter((id) => !map.has(id));
    if (ix && missing.length > 0 && hasActiveFilters(view.filters)) {
      const compiled = compileCriteria(view.filters, ix, { banned });
      for (const id of missing) {
        const line = ix.byLineId.get(id);
        if (line) map.set(id, evaluateLine(line, compiled, view.stageMode));
      }
    }
    return map;
  }, [finder, ix, banned, view.compareLineIds, view.filters, view.stageMode]);
  const adminSwitch = showAdminToggle && onAdminOverride !== undefined;
  // The dock's budget line hides on phones (the bottom bar carries it), so only a verdict or the admin switch
  // keeps the dock worth showing there.
  const dockOnPhone = (pinned !== null && cta.lineReason !== null) || adminSwitch;
  const hoverEntry = hover ? (byId.get(hover.lineId) ?? null) : null;
  const roster = rosterCounts(vm, catalog);

  const pin = (lineId: LineId | null) => dispatch({ type: 'pin', lineId });

  // `screenWithHeader` gives the desktop grid its extra (first) row.
  const screenClass = header ? `${styles.root} ${styles.screen} ${styles.screenWithHeader}` : `${styles.root} ${styles.screen}`;

  const draftButton = (className?: string) => (
    <DraftButton
      ref={draftButtonRef}
      className={className}
      disabled={!cta.enabled}
      reasonText={ctaReason}
      onClick={onDraft}
      variant={cta.variant}
      targetName={cta.target?.name}
    />
  );

  return (
    <div ref={rootRef} className={screenClass}>
      {header ? <div className={styles.screenHeader}>{header}</div> : null}
      <div ref={clockRowRef} className={styles.clockRow}>
        <ClockBar
          vm={vm}
          clock={clock}
          notify={notify}
          onNotifyToggle={onNotifyToggle}
          onExtension={onExtension}
          onOpenPlayers={() => setPlayersOpen(true)}
          tokensHref={links.tokens}
          extensionBusy={extensionBusy}
          makeupSeconds={makeupSeconds}
          onOpenAdmin={vm.viewer.isPoolAdmin ? onOpenAdmin : undefined}
          onPrefetchAdmin={onPrefetchAdmin}
          adminOpen={adminOpen}
        />
      </div>
      <div className={styles.orderRow}>
        <UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} makeupSeconds={makeupSeconds} />
      </div>

      <div className={styles.stagePane}>
        <div className={styles.stageScroll}>
          <section className={styles.stageCard} aria-labelledby={pinned ? headingId : undefined} aria-label={pinned ? undefined : t('stage.selected')}>
            <StageStatus stale={stale} spectator={spectator} />

            {pinned ? (
              <PhoneSection title={t('stage.selected')}>
                <InfoBox
                  entry={pinned}
                  dl={dl}
                  names={pkmnNameResolver}
                  isFavorite={favorites.has(pinned.lineId)}
                  inCompare={view.compareLineIds.includes(pinned.lineId)}
                  compareFull={view.compareLineIds.length >= 3}
                  onToggleFavorite={() => onToggleFavorite(pinned.lineId)}
                  onToggleCompare={() => dispatch({ type: 'toggleCompare', lineId: pinned.lineId })}
                  canFavorite={canFavorite}
                  headingId={headingId}
                />
                {filtersActive ? (
                  <MatchExplanation
                    evaluation={pinnedEvaluation}
                    entry={pinned}
                    filters={view.filters}
                    ix={ix}
                    stageMode={view.stageMode}
                    names={pkmnNameResolver}
                    visibleInResults={visibleInResults}
                    hiddenByTab={hiddenByTab}
                  />
                ) : null}
                <LinePreview entry={pinned} />
              </PhoneSection>
            ) : (
              <div className={`${styles.halftone} flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-lg p-4 text-center`}>
                <p className="font-semibold">{t('stage.empty')}</p>
                <p className="text-sm text-[var(--draft-ink-2)]">{t('stage.emptyHint')}</p>
              </div>
            )}
          </section>

          {/* Outside the card, so the sticky dock is bounded by the whole left column (§5.3). */}
          <div ref={dockRef} className={`${styles.ctaDock} ${dockOnPhone ? '' : styles.ctaDockPhoneEmpty} flex flex-col gap-2`}>
            {pinned ? <CostConsequence remainingAfter={remainingAfter} forPlayer={remainingFor} reason={cta.lineReason} vm={vm} /> : null}
            {draftButton(styles.stageCta)}
            {adminSwitch ? (
              <label className="flex min-h-[44px] items-center gap-2 text-xs md:min-h-0">
                <input
                  ref={adminSwitchRef}
                  type="checkbox"
                  role="switch"
                  checked={adminOverride}
                  onChange={(e) => onAdminOverride?.(e.target.checked)}
                  className={`${styles.focusable} h-4 w-4 accent-[var(--draft-ink)]`}
                />
                <span className="font-semibold">{tGlossary('draft.adminOverride')}</span>
                <span className="text-[var(--draft-ink-2)]">{t('cta.adminHint')}</span>
              </label>
            ) : null}
          </div>

          <div className={styles.extras}>
            {roster ? (
              <PhoneSection title={t('roster.title', roster)}>
                <MyRosterDock
                  vm={vm}
                  catalog={catalog}
                  ix={ix}
                  indexFailed={indexFailed}
                  weaknessStage={weaknessStage}
                  onWeaknessStage={onWeaknessStage}
                  weaknessOpen={weaknessOpen}
                  onPin={pin}
                />
              </PhoneSection>
            ) : null}
            <PhoneSection title={t('recent.title')}>
              <RecentPicks picks={vm.picks} catalog={catalog} onPin={pin} />
            </PhoneSection>
            <CompareTray
              lineIds={view.compareLineIds}
              catalog={catalog}
              ix={ix}
              evaluations={evaluations}
              criteria={filtersActive ? criteria : []}
              onRemove={(id) => dispatch({ type: 'toggleCompare', lineId: id })}
              onPin={pin}
            />
            <nav aria-label={t('links.navLabel')} className="flex flex-wrap gap-2 text-sm">
              {vm.kind === 'redraft' || vm.redraft ? (
                <Link href={links.redraft} className={`${styles.focusable} rounded-lg border border-[var(--draft-border)] px-3 py-1.5 hover:bg-[var(--draft-elevated)]`}>
                  {t('links.redraft')}
                </Link>
              ) : null}
              {vm.viewer.isParticipant ? (
                <Link href={links.tokens} className={`${styles.focusable} rounded-lg border border-[var(--draft-border)] px-3 py-1.5 hover:bg-[var(--draft-elevated)]`}>
                  {t('links.tokens')}
                </Link>
              ) : null}
              <Link
                href={links.trainerCreator}
                className={`${styles.focusable} rounded-lg border border-[var(--draft-border)] px-3 py-1.5 hover:bg-[var(--draft-elevated)]`}
              >
                {t('links.trainerCreator')}
              </Link>
            </nav>
          </div>
        </div>
      </div>

      <section className={styles.wallPane}>
        <FinderBar
          view={view}
          dispatch={dispatch}
          indexReady={ix !== null}
          filterPanelId={filterPanelId}
          filterTriggerId={filterTriggerId(filterPanelId)}
          names={pkmnNameResolver}
        />
        {indexFailed ? (
          <p role="status" className="rounded-lg border border-[var(--draft-border)] bg-[var(--draft-surface)] px-3 py-2 text-sm text-[var(--draft-ink-2)]">
            {t('indexFailed')}
          </p>
        ) : null}
        {/* Always rendered (also before the index loads), so the wall never jumps when chips come and go. */}
        <ActiveFilterChips
          chips={finder?.activeChips ?? buildChips(view.filters)}
          count={finder?.matchingAllTabs ?? catalog.lines.length}
          onRemove={(chipId) => dispatch({ type: 'removeChip', chipId })}
          onClearAll={() => dispatch({ type: 'clearAll' })}
          names={pkmnNameResolver}
        />
        {/* Pinned on top of the wall, outside the scrolling grid: always visible, also before the index loads (owner feedback 2026-10-18). */}
        <PriceTabs
          active={view.tab}
          counts={finder?.tabCounts ?? catalogTabCounts}
          filtersActive={finder !== null && filtersActive}
          onSelect={(tab) => dispatch({ type: 'setTab', tab })}
          controlsId={wallId}
          className={styles.wallTabs}
        />
        <RosterWall
          id={wallId}
          className={styles.wallScroll}
          scrollRef={wallScrollRef}
          rows={finder?.rows ?? null}
          catalog={catalog}
          vm={vm}
          favorites={favorites}
          pinnedLineId={view.pinnedLineId}
          compareIds={view.compareLineIds}
          onPin={pin}
          onToggleFavorite={onToggleFavorite}
          onToggleCompare={(lineId) => dispatch({ type: 'toggleCompare', lineId })}
          onHover={(lineId, anchor) => onHover(lineId === null ? null : { lineId, anchor })}
          lineStatus={cta.variant === 'admin' ? (vm.viewer.activePlayerLineStatus ?? undefined) : undefined}
          names={pkmnNameResolver}
        />
        <HoverDetails
          lineId={hoverEntry ? hoverEntry.lineId : null}
          anchor={hover?.anchor ?? null}
          entry={hoverEntry}
          evaluation={hoverEntry ? (evaluations.get(hoverEntry.lineId) ?? null) : null}
          filters={view.filters}
          ix={ix}
          stageMode={view.stageMode}
          names={pkmnNameResolver}
        />
      </section>

      {/* The filter sheet is portalled (Radix), so it sits outside the wall pane and its clipping. */}
      {ix ? (
        <FilterPanel
          id={filterPanelId}
          view={view}
          dispatch={dispatch}
          ix={ix}
          names={pkmnNameResolver}
          dl={dl}
          banned={banned}
          count={finder?.matchingAllTabs ?? catalog.lines.length}
        />
      ) : null}

      {/* Phone: sticky bottom bar (§5.3 item 7): the budget left after the pick and DRAFT, no price. */}
      <div className={styles.bottomBar}>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold">
            {pinned && remainingAfter !== null ? <RemainingAfterPick remaining={remainingAfter} forPlayer={remainingFor} /> : null}
          </p>
          <DraftButton
            ref={draftBarButtonRef}
            disabled={!cta.enabled}
            reasonText={null}
            describedBy={!cta.enabled && ctaReason ? barReasonId : undefined}
            onClick={onDraft}
            variant={cta.variant}
            targetName={cta.target?.name}
          />
        </div>
        {!cta.enabled && ctaReason ? (
          <p id={barReasonId} className="text-xs text-[var(--draft-ink-2)]">
            {ctaReason}
          </p>
        ) : null}
      </div>

      <PlayersSheet
        vm={vm}
        catalog={catalog}
        open={playersOpen}
        onClose={() => setPlayersOpen(false)}
        notify={notify}
        onNotifyToggle={onNotifyToggle}
      />
    </div>
  );
}
