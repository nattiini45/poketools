'use client';

/**
 * The last picks (draft-frontend §5.5): the newest three, and "Show all"
 * expanding every pick grouped by round. A click pins the line.
 */
import { useDataLocale, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import { RECENT_PICKS_COUNT } from '@/lib/draft-ui/constants';
import type { PickVM } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import styles from '../draft-tool.module.css';

export interface RecentPicksProps {
  /** Ascending by pick number (`vm.picks`). */
  picks: PickVM[];
  catalog: DraftLineCatalog;
  onPin(lineId: LineId): void;
}

function PickRow({ pick, entry, onPin }: { pick: PickVM; entry: DraftLineCatalogEntry | undefined; onPin(id: LineId): void }) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const dl = useDataLocale();
  const line = entry ? pkmnNameResolver.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl) : t('recent.unknownLine');
  return (
    <li>
      <button
        type="button"
        onClick={() => onPin(pick.line_id)}
        className={`${styles.focusable} flex w-full min-w-0 items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-[var(--draft-elevated)]`}
      >
        <span className={`${styles.digits} shrink-0 text-xs text-[var(--draft-ink-2)]`}>{t('recent.pickNumber', { pick: pick.pick_number })}</span>
        <span className="shrink-0 font-semibold">{pick.playerName}</span>
        <span className="min-w-0 flex-1 truncate" title={line}>
          {line}
        </span>
        <span className="shrink-0 text-xs text-[var(--draft-ink-2)]">{tShared('points', { n: pick.price })}</span>
        {pick.admin_override ? (
          <span className="shrink-0 rounded border border-[var(--draft-border)] px-1 text-[0.625rem] uppercase">{t('recent.adminMark')}</span>
        ) : null}
      </button>
    </li>
  );
}

export default function RecentPicks({ picks, catalog, onPin }: RecentPicksProps) {
  const t = useT(draftScreenMessages);
  const byId = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
  const recent = picks.slice(-RECENT_PICKS_COUNT).reverse();
  const rounds = new Map<number, PickVM[]>();
  for (const p of picks) {
    const list = rounds.get(p.round);
    if (list) list.push(p);
    else rounds.set(p.round, [p]);
  }

  return (
    <section className="flex flex-col gap-1" aria-label={t('recent.title')}>
      {/* On phones the collapsible section's toggle carries this title. */}
      <h3 className={`${styles.phoneHideHeading} text-sm font-semibold`}>{t('recent.title')}</h3>
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--draft-ink-2)]">{t('recent.none')}</p>
      ) : (
        <ul className="flex flex-col">
          {recent.map((p) => (
            <PickRow key={p.pick_id} pick={p} entry={byId.get(p.line_id)} onPin={onPin} />
          ))}
        </ul>
      )}
      {picks.length > recent.length ? (
        <details className="text-sm">
          <summary className={`${styles.focusable} cursor-pointer rounded text-[var(--draft-ink-2)] hover:text-[var(--draft-ink)]`}>
            {t('recent.showAll', { count: picks.length })}
          </summary>
          <div className="mt-1 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {[...rounds.entries()].map(([round, list]) => (
              <div key={round}>
                <h4 className="text-xs font-semibold text-[var(--draft-ink-2)]">{t('recent.round', { round })}</h4>
                <ul className="flex flex-col">
                  {list.map((p) => (
                    <PickRow key={p.pick_id} pick={p} entry={byId.get(p.line_id)} onPin={onPin} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
