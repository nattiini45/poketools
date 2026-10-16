'use client';

/**
 * Compare up to three lines side by side (draft-frontend §5.5, SPEC:423-431):
 * price, types per stage, evolution requirements and the active filters
 * (✓/✕). A collapsible strip at the bottom of the left column.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import type { LineEvaluation } from '@/lib/draft-finder/engine';
import { MAX_COMPARE } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import type { CriterionLabel } from './criterion-text';
import styles from '../draft-tool.module.css';

export interface CompareTrayProps {
  lineIds: LineId[];
  catalog: DraftLineCatalog;
  ix: PreparedIndex | null;
  /** Per-line evaluation against the active filters; a line without one shows no ✓/✕ rows. */
  evaluations: Map<LineId, LineEvaluation>;
  /** Labels of the active criteria (empty without filters). */
  criteria?: CriterionLabel[];
  onRemove(id: LineId): void;
  onPin(id: LineId): void;
}

function Column({
  entry,
  ix,
  evaluation,
  criteria,
  onRemove,
  onPin,
}: {
  entry: DraftLineCatalogEntry;
  ix: PreparedIndex | null;
  evaluation: LineEvaluation | undefined;
  criteria: CriterionLabel[];
  onRemove(id: LineId): void;
  onPin(id: LineId): void;
}) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const dl = useDataLocale();
  const line = pkmnNameResolver.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl);
  const indexed = ix?.byLineId.get(entry.lineId);
  const resultOf = new Map((evaluation?.results ?? []).map((r) => [r.criterionId, r]));
  const k = [entry.thresholds.toStage2, entry.thresholds.additionalToStage3];

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--draft-border)] bg-[var(--draft-elevated)] p-2">
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onPin(entry.lineId)}
          className={`${styles.focusable} min-w-0 flex-1 truncate rounded text-left text-sm font-bold hover:underline`}
          title={line}
          aria-label={t('compare.show', { line })}
        >
          {line}
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry.lineId)}
          aria-label={t('compare.remove', { line })}
          className={`${styles.focusable} shrink-0 rounded p-1 text-[var(--draft-ink-2)] hover:text-[var(--draft-ink)]`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div>
          <dt className="text-[var(--draft-ink-2)]">{t('compare.price')}</dt>
          <dd className="font-semibold">{tShared('points', { n: entry.price })}</dd>
        </div>
        <div>
          <dt className="text-[var(--draft-ink-2)]">{t('compare.types')}</dt>
          <dd className="flex flex-col gap-1">
            {entry.stages.map((s, i) => {
              const types = indexed?.stages.find((st) => st.stage === s.stage)?.types ?? [];
              return (
                <div key={s.stage} className="flex flex-wrap items-center gap-1">
                  <PokemonSprite name={s.name} size={24} />
                  {types.map((type) => (
                    <TypeBadge key={type} type={type} className="!min-w-0 !px-1.5 !text-[0.625rem]" />
                  ))}
                  {i > 0 && k[i - 1] !== null && k[i - 1] !== undefined ? (
                    <span className="text-[var(--draft-ink-2)]">{t('compare.evolveAt', { k: k[i - 1] as number })}</span>
                  ) : null}
                </div>
              );
            })}
          </dd>
        </div>
        {criteria.length > 0 && evaluation ? (
          <div>
            <dt className="text-[var(--draft-ink-2)]">{t('compare.filters')}</dt>
            <dd>
              <ul>
                {criteria.map((c) => {
                  const ok = resultOf.get(c.id)?.satisfied ?? false;
                  return (
                    <li key={c.id} className={ok ? 'font-semibold' : 'text-[var(--draft-ink-2)]'}>
                      {ok ? t('explain.matched', { criterion: c.label }) : t('explain.failed', { criterion: c.label })}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

export default function CompareTray({ lineIds, catalog, ix, evaluations, criteria = [], onRemove, onPin }: CompareTrayProps) {
  const t = useT(draftScreenMessages);
  const byId = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
  const entries = lineIds.map((id) => byId.get(id)).filter((e): e is DraftLineCatalogEntry => e !== undefined);
  // The user's toggle owns the open state; adding the first line opens the tray once.
  const hasEntries = entries.length > 0;
  const [open, setOpen] = useState(hasEntries);
  const [hadEntries, setHadEntries] = useState(hasEntries);
  if (hadEntries !== hasEntries) {
    setHadEntries(hasEntries);
    if (hasEntries) setOpen(true);
  }

  return (
    <details
      className="rounded-lg border border-[var(--draft-border)] p-2"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className={`${styles.focusable} cursor-pointer rounded text-sm font-semibold`}>
        {t('compare.title', { n: entries.length, max: MAX_COMPARE })}
      </summary>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--draft-ink-2)]">{t('compare.empty')}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {entries.map((entry) => (
            <Column
              key={entry.lineId}
              entry={entry}
              ix={ix}
              evaluation={evaluations.get(entry.lineId)}
              criteria={criteria}
              onRemove={onRemove}
              onPin={onPin}
            />
          ))}
        </ul>
      )}
    </details>
  );
}
