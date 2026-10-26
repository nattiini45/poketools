'use client';

/**
 * Team weakness overview under "My roster" (draft-frontend §5.5): which attacking types the owned lines are
 * weak to. A collapsed `Disclosure`; inside, a Base | Final switch (the persisted `weaknessStage` preference),
 * a table with one row per owned line (the selected stage's sprite, its name as the accessible name; a click
 * pins the line like a dock tile) and one column per attacking type (vertical type names tinted with the type
 * colours), and three count rows (Weak / Resist / Immune).
 *
 * Factual only: multipliers and counts, no verdict. Typing only, which a note under the table says.
 * Types come from the search index; while it loads the body is a short loading line, and when it failed the
 * overview is hidden. A line the index does not know, or a stage whose types it could not resolve, shows "no
 * data" in its row and is left out of the counts, never an all-neutral row.
 */
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { SORT_STAGES, type SortStage } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import { lineStage, type PreparedIndex } from '@/lib/draft-finder/prepare';
import {
  defensiveProfile,
  effectOf,
  multiplierLabel,
  summarizeTeam,
  type DefensiveProfile,
  type Effect,
} from '@/lib/draft-finder/team-weakness';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import { TYPES } from '@/lib/pkmn/type-chart';
import styles from '../draft-tool.module.css';
import Disclosure from '../shared/Disclosure';
import SegmentedControl from '../shared/SegmentedControl';

export interface TeamWeaknessTableProps {
  /** The viewer's owned lines (at least one). */
  owned: readonly DraftLineCatalogEntry[];
  /** The prepared search index; null while it loads. */
  ix: PreparedIndex | null;
  /** The index failed to load: the overview is hidden. */
  indexFailed: boolean;
  stage: SortStage;
  onStageChange(stage: SortStage): void;
  /** Starts expanded (preview scenarios); collapsed by default. */
  defaultOpen?: boolean;
  onPin(lineId: LineId): void;
}

export interface WeaknessRow {
  lineId: LineId;
  /** The canonical English name of the line's stage at the selected `stage` (sprite key, localised for display). */
  name: string;
  /** The typing's multipliers, or null when the index has no types for this stage. */
  profile: DefensiveProfile | null;
}

/** One row per owned line, read at `stage`. Pure; the types come from the index, matched by stage number. */
export function weaknessRows(owned: readonly DraftLineCatalogEntry[], ix: PreparedIndex, stage: SortStage): WeaknessRow[] {
  return owned.map((entry) => {
    const picked = lineStage(entry, stage);
    const types = ix.byLineId.get(entry.lineId)?.stages.find((s) => s.stage === picked.stage)?.types ?? [];
    return { lineId: entry.lineId, name: picked.name, profile: defensiveProfile(types) };
  });
}

const CELL_CLASS: Record<Effect, string | undefined> = {
  quad: styles.weaknessQuad,
  weak: styles.weaknessWeak,
  resist: styles.weaknessResist,
  immune: styles.weaknessImmune,
  neutral: undefined,
};

/**
 * Tailwind overrides that shrink the site-wide type pill to a narrow vertical column head. In the vertical
 * writing mode the pill's width is its line height plus the side padding, so the tight line height is what
 * lets 18 columns fit the desktop left pane.
 */
const TYPE_HEAD_CLASS = `${styles.weaknessTypeHead} !min-w-0 !px-0.5 !py-1.5 !text-[0.625rem] !leading-[1.1] !tracking-normal`;

export default function TeamWeaknessTable({ owned, ix, indexFailed, stage, onStageChange, defaultOpen = false, onPin }: TeamWeaknessTableProps) {
  const t = useT(draftScreenMessages);
  const tFinder = useT(draftFinderMessages);
  const dl = useDataLocale();
  if (indexFailed) return null;

  const rows = ix ? weaknessRows(owned, ix, stage) : [];
  const tallies = summarizeTeam(rows.map((row) => row.profile));
  const tallyRows = [
    { key: 'weak', label: t('roster.weakness.rowWeak') },
    { key: 'resist', label: t('roster.weakness.rowResist') },
    { key: 'immune', label: t('roster.weakness.rowImmune') },
  ] as const;

  return (
    <Disclosure summary={t('roster.weakness.title')} defaultOpen={defaultOpen} className="mt-1.5">
      <div className="mt-2 flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--draft-ink-2)]">
          <span aria-hidden="true">{t('roster.weakness.stageLabel')}</span>
          <SegmentedControl
            value={stage}
            onChange={onStageChange}
            ariaLabel={t('roster.weakness.stageLabel')}
            options={SORT_STAGES.map((value) => ({ value, label: tFinder(`sort.stage.${value}`) }))}
          />
        </span>
        {ix === null ? (
          <p className="text-sm text-[var(--draft-ink-2)]">{t('roster.weakness.loading')}</p>
        ) : (
          <>
            <div className={styles.weaknessScroll}>
              <table className={styles.weaknessTable}>
                <caption className="sr-only">{t('roster.weakness.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={styles.weaknessRowHead}>
                      <span className="sr-only">{t('roster.weakness.pokemon')}</span>
                    </th>
                    {TYPES.map((type) => (
                      <th key={type} scope="col" className={styles.weaknessTypeCell}>
                        <TypeBadge type={type} className={TYPE_HEAD_CLASS} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const name = pkmnNameResolver.species(row.name, dl);
                    return (
                      <tr key={row.lineId}>
                        <th scope="row" className={styles.weaknessRowHead}>
                          <button
                            type="button"
                            onClick={() => onPin(row.lineId)}
                            aria-label={name}
                            title={name}
                            className={`${styles.focusable} inline-flex rounded`}
                          >
                            <PokemonSprite name={row.name} size={28} />
                          </button>
                        </th>
                        {row.profile ? (
                          row.profile.map((multiplier, i) => (
                            <td key={TYPES[i]} className={CELL_CLASS[effectOf(multiplier)]}>
                              {multiplierLabel(multiplier)}
                            </td>
                          ))
                        ) : (
                          <td colSpan={TYPES.length} className="px-2 py-1 text-left text-[var(--draft-ink-2)]">
                            {t('roster.weakness.noData')}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {tallyRows.map(({ key, label }) => (
                    <tr key={key}>
                      <th scope="row" className={`${styles.weaknessRowHead} px-1 text-left font-semibold`}>
                        {label}
                      </th>
                      {tallies.map((tally, i) => (
                        <td key={TYPES[i]} className={tally[key] === 0 ? 'text-[var(--draft-ink-2)] opacity-60' : 'font-bold'}>
                          {tally[key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-[var(--draft-ink-2)]">{t('roster.weakness.note')}</p>
          </>
        )}
      </div>
    </Disclosure>
  );
}
