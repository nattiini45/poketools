'use client';

/**
 * The EPB pick screen layout (draft-frontend §5.3, §5.5): clock bar and
 * order strip on top; the left stage (info box, why it matches, staged
 * sprites, cost and the DRAFT button, roster dock, last picks, compare); the
 * roster wall on the right with the finder. Presentational apart from local
 * UI state (players sheet, hover intent): it never fetches, and every write
 * goes through the callbacks of `DraftToolClient`.
 *
 * Phones get the §5.3 order (selected card → wall → roster/picks/compare) and
 * a sticky bottom bar with the DRAFT button; desktop the diagonal split.
 */
import { useId, useMemo, useState, type Dispatch, type Ref } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { compileCriteria, evaluateLine, type FinderResult, type LineEvaluation } from '@/lib/draft-finder/engine';
import { hasActiveFilters, type FinderAction, type FinderViewState } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { tabOf } from '@/lib/draft-finder/tabs';
import type { ClockView } from '@/lib/draft-ui/clock';
import { reasonText } from '@/lib/draft-ui/reasons';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { ExtensionKind, LineId } from '@/lib/draft-ui/snapshot-types';
import { useHoverIntent } from './hooks/use-hover-intent';
import type { NotifyState } from './hooks/use-turn-watch';
import ClockBar from './layout/ClockBar';
import PhoneSection from './layout/PhoneSection';
import PlayersSheet from './layout/PlayersSheet';
import UpcomingOrderStrip from './layout/UpcomingOrderStrip';
import CompareTray from './left/CompareTray';
import CostConsequence from './left/CostConsequence';
import { criterionLabel, resultReason, type CriterionLabel, type CriterionTextDeps } from './left/criterion-text';
import { ctaStateOf, type CtaState } from './left/cta-state';
import DraftButton from './left/DraftButton';
import InfoBox from './left/InfoBox';
import LinePreview from './left/LinePreview';
import MatchExplanation from './left/MatchExplanation';
import MyRosterDock, { rosterCounts } from './left/MyRosterDock';
import RecentPicks from './left/RecentPicks';
import ActiveFilterChips from './right/ActiveFilterChips';
import FilterPanel from './right/FilterPanel';
import FinderBar from './right/FinderBar';
import HoverDetails from './right/HoverDetails';
import PriceTabs from './right/PriceTabs';
import RosterWall from './right/RosterWall';
import styles from './draft-tool.module.css';

export interface DraftToolLinks {
  redraft: string;
  tokens: string;
  admin: string | null;
  trainerCreator: string;
}

export interface DraftToolScreenProps {
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
}

export default function DraftToolScreen({
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
  stale = false,
  authBlocked = false,
  makeupSeconds = null,
  extensionBusy = false,
  draftButtonRef,
  draftBarButtonRef,
  canFavorite = true,
}: DraftToolScreenProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const f = useFormatter();
  const dl = useDataLocale();
  const headingId = useId();
  const filterPanelId = useId();
  const wallId = useId();
  const barReasonId = useId();
  const pathname = usePathname();
  const [playersOpen, setPlayersOpen] = useState(false);
  const { intent: hover, onHover } = useHoverIntent<{ lineId: LineId; anchor: HTMLElement | null }>();

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

  // Criteria labels and per-criterion reasons for the explanation and the compare tray.
  const textDeps: CriterionTextDeps = { filters: view.filters, ix, names: pkmnNameResolver, dl, t, tGlossary, f };
  const pinnedEvaluation = finder?.pinnedEvaluation ?? null;
  const criteria: CriterionLabel[] = (pinnedEvaluation?.results ?? finder?.rows[0]?.evaluation.results ?? []).map((r) => ({
    id: r.criterionId,
    label: criterionLabel(r.criterionId, textDeps),
  }));
  const reasons: Record<string, string | null> = {};
  for (const r of pinnedEvaluation?.results ?? []) reasons[r.criterionId] = resultReason(r, textDeps);
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
  const signInHref = pathname ? `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}` : '/auth/signin';
  const hoverEntry = hover ? (byId.get(hover.lineId) ?? null) : null;
  const roster = rosterCounts(vm, catalog);

  const pin = (lineId: LineId | null) => dispatch({ type: 'pin', lineId });

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
    <div className={`${styles.root} ${styles.screen}`}>
      <div className={styles.clockRow}>
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
        />
      </div>
      <div className={styles.orderRow}>
        <UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} makeupSeconds={makeupSeconds} />
      </div>

      <div className={styles.stagePane}>
        <section className={styles.stageCard} aria-labelledby={pinned ? headingId : undefined} aria-label={pinned ? undefined : t('stage.selected')}>
          {stale ? (
            <p role="status" className="flex items-center gap-2 rounded-lg border border-[var(--draft-border)] px-3 py-2 text-sm text-[var(--draft-ink-2)]">
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('stale')}
            </p>
          ) : null}
          {spectator ? (
            <p className="rounded-lg border border-[var(--draft-border)] px-3 py-2 text-sm text-[var(--draft-ink-2)]">
              {spectator === 'guest' ? t('spectator.guest') : t('spectator.nonParticipant')}
              {spectator === 'guest' ? (
                <>
                  {' '}
                  <Link href={signInHref} className={`${styles.focusable} rounded font-semibold text-[var(--draft-ink)] underline`}>
                    {t('spectator.signIn')}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}

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
                  criteria={criteria}
                  reasons={reasons}
                  visibleInResults={visibleInResults}
                  hiddenByTab={hiddenByTab}
                />
              ) : null}
              <div className={styles.wideOnly}>
                <LinePreview entry={pinned} />
              </div>
              {/* Phones: 72/88/104 px sprites (§5.3 item 3). */}
              <div className={styles.phoneOnly}>
                <LinePreview entry={pinned} compact />
              </div>
            </PhoneSection>
          ) : (
            <div className={`${styles.halftone} flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-lg p-4 text-center`}>
              <p className="font-semibold">{t('stage.empty')}</p>
              <p className="text-sm text-[var(--draft-ink-2)]">{t('stage.emptyHint')}</p>
            </div>
          )}

        </section>

        {/* Outside the card, so the sticky dock is bounded by the whole left column (§5.3). */}
        <div className={`${styles.ctaDock} ${pinned || adminSwitch ? '' : styles.ctaDockPhoneEmpty} flex flex-col gap-2`}>
          {pinned ? (
            <CostConsequence
              price={pinned.price}
              remainingAfter={cta.remainingAfter}
              reason={cta.lineReason}
              vm={vm}
              spectator={spectator !== null && cta.variant === 'player'}
            />
          ) : null}
          {draftButton(styles.stageCta)}
          {adminSwitch ? (
            <label className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-0">
              <input
                type="checkbox"
                role="switch"
                checked={adminOverride}
                onChange={(e) => onAdminOverride?.(e.target.checked)}
                className={`${styles.focusable} h-4 w-4 accent-[var(--draft-cta)]`}
              />
              <span className="font-semibold">{tGlossary('draft.adminOverride')}</span>
              <span className="text-xs text-[var(--draft-ink-2)]">{t('cta.adminHint')}</span>
            </label>
          ) : null}
        </div>

        <div className={styles.extras}>
          {roster ? (
            <PhoneSection title={t('roster.title', roster)}>
              <MyRosterDock vm={vm} catalog={catalog} onPin={pin} />
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
            {links.admin ? (
              <Link href={links.admin} className={`${styles.focusable} rounded-lg border border-[var(--draft-border)] px-3 py-1.5 hover:bg-[var(--draft-elevated)]`}>
                {t('links.admin')}
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

      <section className={styles.wallPane}>
        <FinderBar
          view={view}
          dispatch={dispatch}
          count={finder?.matchingAllTabs ?? catalog.lines.length}
          indexReady={ix !== null}
          filterPanelId={filterPanelId}
          names={pkmnNameResolver}
        />
        {indexFailed ? (
          <p role="status" className="rounded-lg border border-[var(--draft-border)] bg-[var(--draft-surface)] px-3 py-2 text-sm text-[var(--draft-ink-2)]">
            {t('indexFailed')}
          </p>
        ) : null}
        {ix ? (
          <FilterPanel id={filterPanelId} view={view} dispatch={dispatch} ix={ix} names={pkmnNameResolver} dl={dl} banned={banned} />
        ) : null}
        {finder ? (
          <ActiveFilterChips
            chips={finder.activeChips}
            count={finder.matchingAllTabs}
            onRemove={(chipId) => dispatch({ type: 'removeChip', chipId })}
            onClearAll={() => dispatch({ type: 'clearAll' })}
            names={pkmnNameResolver}
          />
        ) : null}
        <RosterWall
          id={wallId}
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
        {finder ? (
          <PriceTabs
            active={view.tab}
            counts={finder.tabCounts}
            filtersActive={filtersActive}
            onSelect={(tab) => dispatch({ type: 'setTab', tab })}
            controlsId={wallId}
          />
        ) : null}
      </section>

      {/* Phone: sticky bottom bar (§5.3 item 7). */}
      <div className={styles.bottomBar}>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm">
            {pinned ? (
              <>
                <span className="font-bold">{tShared('points', { n: pinned.price })}</span>
                {cta.remainingAfter !== null ? (
                  <span className={`ml-2 ${cta.remainingAfter < 0 ? 'text-[var(--draft-warn-ink)]' : 'text-[var(--draft-ink-2)]'}`}>
                    {t('cost.remaining', { n: cta.remainingAfter })}
                  </span>
                ) : null}
              </>
            ) : null}
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
