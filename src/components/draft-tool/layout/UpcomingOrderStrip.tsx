'use client';

/**
 * The next picks (draft-frontend §5.3, §5.5): up to 10 chips with the pick
 * number and the player; the viewer's chips are highlighted; make-up picks
 * carry "↻" and their shorter time; a separator marks each round change.
 * The strip scrolls horizontally on its own (never the page).
 */
import { Fragment } from 'react';
import { useFormatter, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { ActiveSlotVM, UpcomingVM } from '@/lib/draft-ui/snapshot-adapter';
import styles from '../draft-tool.module.css';

export const UPCOMING_CHIPS = 10;

export interface UpcomingOrderStripProps {
  items: UpcomingVM[];
  activeSlot: ActiveSlotVM | null;
  /** `config.makeup_seconds`, shown on make-up chips; null in a slow draft, whose slots all use the ladder time. */
  makeupSeconds?: number | null;
  /** How many chips to show (default 10; the tablet clock bar shows 5). */
  limit?: number;
}

export default function UpcomingOrderStrip({ items, activeSlot, makeupSeconds = null, limit = UPCOMING_CHIPS }: UpcomingOrderStripProps) {
  const t = useT(draftScreenMessages);
  const f = useFormatter();
  const shown = items.slice(0, limit);
  if (shown.length === 0) return null;
  const makeupTime = makeupSeconds !== null ? f.clock(makeupSeconds) : null;

  return (
    <ol className={styles.orderStrip} aria-label={t('order.label')}>
      {shown.map((item, i) => {
        const breakBefore = item.roundBreakBefore && (i > 0 || activeSlot !== null);
        const name = item.isViewer ? t('order.you') : item.name;
        const aria =
          item.kind !== 'makeup'
            ? t('order.pickAria', { pick: item.pickNumber, player: item.name })
            : makeupTime
              ? t('order.makeupAria', { pick: item.pickNumber, player: item.name, time: makeupTime })
              : t('order.makeupAriaNoTime', { pick: item.pickNumber, player: item.name });
        return (
          <Fragment key={item.slotId}>
            {breakBefore ? (
              <li className={styles.orderBreak} aria-hidden="true" title={t('order.roundBreak', { round: item.round })} />
            ) : null}
            <li className={`${styles.orderChip} ${item.isViewer ? styles.orderChipViewer : ''}`} aria-label={aria}>
              <span className={`${styles.digits} text-xs text-[var(--draft-ink-2)]`} aria-hidden="true">
                {item.pickNumber}
              </span>
              <span className="truncate" title={item.name} aria-hidden="true">
                {name}
              </span>
              {item.kind === 'makeup' ? (
                <span className={`${styles.digits} text-xs text-[var(--draft-ink-2)]`} aria-hidden="true">
                  ↻{makeupTime ? ` ${makeupTime}` : ''}
                </span>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
