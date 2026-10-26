'use client';

/**
 * The viewer's roster (draft-frontend §5.5): one tile per roster slot —
 * owned lines (stage-1 sprite and price; a click pins the line), empty
 * dashed slots, and in a redraft the open slots A/B/C with the real KOs they
 * carry. Under the tiles sits the collapsed team weakness overview
 * (`TeamWeaknessTable`), shown once the viewer owns a line.
 *
 * No team judgement (SPEC:437): the tiles and the weakness table are factual
 * (prices, damage multipliers, counts); nothing here rates or scores a team.
 */
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import type { SortStage } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import styles from '../draft-tool.module.css';
import TeamWeaknessTable from './TeamWeaknessTable';

export interface MyRosterDockProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  /** The prepared search index (the weakness overview reads the types from it); null while it loads. */
  ix: PreparedIndex | null;
  /** The index failed to load: the weakness overview is hidden. */
  indexFailed: boolean;
  /** The stage (Base | Final) the weakness overview reads. */
  weaknessStage: SortStage;
  onWeaknessStage(stage: SortStage): void;
  /** The weakness overview starts expanded (preview scenarios). */
  initialWeaknessOpen: boolean;
  onPin(lineId: LineId): void;
}

interface RosterLayout {
  owned: DraftLineCatalogEntry[];
  openRedraft: DraftViewModel['viewer']['redraftSlots'];
  total: number;
}

function rosterLayout(vm: DraftViewModel, catalog: DraftLineCatalog): RosterLayout | null {
  const me = vm.participants.find((p) => p.isViewer);
  if (!me) return null;
  const byId = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
  const owned = me.rosterLineIds.map((id) => byId.get(id)).filter((e): e is DraftLineCatalogEntry => e !== undefined);
  const openRedraft = vm.viewer.redraftSlots.filter((s) => s.open);
  return { owned, openRedraft, total: Math.max(me.slots_total, owned.length + openRedraft.length) };
}

/** The "My roster (n/total)" counts, or null when the viewer has no roster (spectator). */
export function rosterCounts(vm: DraftViewModel, catalog: DraftLineCatalog): { n: number; total: number } | null {
  const layout = rosterLayout(vm, catalog);
  return layout ? { n: layout.owned.length, total: layout.total } : null;
}

export default function MyRosterDock({ vm, catalog, ix, indexFailed, weaknessStage, onWeaknessStage, initialWeaknessOpen, onPin }: MyRosterDockProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const dl = useDataLocale();
  const layout = rosterLayout(vm, catalog);
  if (!layout) return null;

  const { owned, openRedraft, total } = layout;
  const empty = Math.max(0, total - owned.length - openRedraft.length);

  return (
    <section className="flex flex-col gap-1.5" aria-label={t('roster.title', { n: owned.length, total })}>
      {/* On phones the collapsible section's toggle carries this title. */}
      <h3 className={`${styles.phoneHideHeading} text-sm font-semibold`}>{t('roster.title', { n: owned.length, total })}</h3>
      <ul className="flex flex-wrap gap-1.5 pl-1">
        {owned.map((entry) => {
          const line = pkmnNameResolver.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl);
          return (
            <li key={entry.lineId}>
              <button
                type="button"
                onClick={() => onPin(entry.lineId)}
                aria-label={t('roster.pinAria', { line, price: entry.price })}
                title={line}
                className={`${styles.dockTile} ${styles.focusable}`}
              >
                <span className="flex flex-col items-center">
                  <PokemonSprite name={entry.stages[0].name} size={36} />
                  <span className="text-[0.6875rem] font-bold leading-none">{tShared('points', { n: entry.price })}</span>
                </span>
              </button>
            </li>
          );
        })}
        {openRedraft.map((slot) => (
          <li key={slot.redraftSlotId} className={`${styles.dockTile} ${styles.dockEmpty} px-1.5`}>
            <span className="text-center text-[0.6875rem] font-semibold leading-tight">
              {t('roster.redraftSlot', { label: slot.label, count: slot.transferredRealKills })}
            </span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className={`${styles.dockTile} ${styles.dockEmpty}`} title={t('roster.emptySlot')}>
            <span className="sr-only">{t('roster.emptySlot')}</span>
          </li>
        ))}
      </ul>
      {owned.length > 0 ? (
        <TeamWeaknessTable
          owned={owned}
          ix={ix}
          indexFailed={indexFailed}
          stage={weaknessStage}
          onStageChange={onWeaknessStage}
          defaultOpen={initialWeaknessOpen}
          onPin={onPin}
        />
      ) : null}
    </section>
  );
}
