'use client';

/**
 * The pick order (draft-frontend §5.3, §5.5): a filled "On the clock" chip for
 * the active slot, then up to 10 chips with the pick number and the player;
 * the viewer's chips are highlighted; make-up chips are dashed, labelled
 * "Make-up" and carry "↻" with their shorter time, so their older pick numbers
 * read as intended; a labelled separator ("R4") marks each round change. The
 * strip scrolls horizontally on its own (never the page).
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
  /** Open with the active slot's "On the clock" chip (default). The tablet clock bar names that player itself. */
  showNow?: boolean;
  /** The draft is paused: the "On the clock" chip's live dot stops. */
  paused?: boolean;
}

export default function UpcomingOrderStrip({
  items,
  activeSlot,
  makeupSeconds = null,
  limit = UPCOMING_CHIPS,
  showNow = true,
  paused = false,
}: UpcomingOrderStripProps) {
  const t = useT(draftScreenMessages);
  const f = useFormatter();
  const shown = items.slice(0, limit);
  const now = showNow ? activeSlot : null;
  if (shown.length === 0 && !now) return null;
  const makeupTime = makeupSeconds !== null ? f.clock(makeupSeconds) : null;

  return (
    <ol className={styles.orderStrip} aria-label={t('order.label')}>
      {now ? (
        <li
          className={`${styles.orderChip} ${styles.orderChipNow} ${now.kind === 'makeup' ? styles.orderChipMakeup : ''}`}
          aria-label={
            now.kind === 'makeup'
              ? t('order.nowMakeupAria', { pick: now.pick_number, player: now.playerName })
              : t('order.nowAria', { pick: now.pick_number, player: now.playerName })
          }
        >
          <span className={`${styles.liveDot} ${paused ? styles.liveDotPaused : ''}`} aria-hidden="true" />
          <span className="text-xs font-bold" aria-hidden="true">
            {t('order.now')}
          </span>
          <span className={`${styles.digits} text-xs`} aria-hidden="true">
            {now.pick_number}
          </span>
          <span className="truncate" title={now.playerName} aria-hidden="true">
            {now.isViewer ? t('order.you') : now.playerName}
          </span>
        </li>
      ) : null}
      {now && shown.length > 0 ? (
        <li className={styles.orderLabel} aria-hidden="true">
          {t('order.upNext')}
        </li>
      ) : null}
      {shown.map((item, i) => {
        const breakBefore = item.roundBreakBefore && (i > 0 || activeSlot !== null);
        const name = item.isViewer ? t('order.you') : item.name;
        const makeup = item.kind === 'makeup';
        const aria = !makeup
          ? t('order.pickAria', { pick: item.pickNumber, player: item.name })
          : makeupTime
            ? t('order.makeupAria', { pick: item.pickNumber, player: item.name, time: makeupTime })
            : t('order.makeupAriaNoTime', { pick: item.pickNumber, player: item.name });
        return (
          <Fragment key={item.slotId}>
            {breakBefore ? (
              <li className={styles.orderBreak} aria-hidden="true" title={t('order.roundBreak', { round: item.round })}>
                {t('order.roundShort', { round: item.round })}
              </li>
            ) : null}
            <li
              className={`${styles.orderChip} ${item.isViewer ? styles.orderChipViewer : ''} ${makeup ? styles.orderChipMakeup : ''}`}
              aria-label={aria}
            >
              <span className={`${styles.digits} text-xs text-[var(--draft-ink-2)]`} aria-hidden="true">
                {item.pickNumber}
              </span>
              <span className="truncate" title={item.name} aria-hidden="true">
                {name}
              </span>
              {makeup ? (
                <span className={`${styles.digits} text-xs text-[var(--draft-ink-2)]`} aria-hidden="true">
                  {t('order.makeup')} ↻{makeupTime ? ` ${makeupTime}` : ''}
                </span>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
