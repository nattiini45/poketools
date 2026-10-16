'use client';

/**
 * The published redraft (draft-frontend §6.1; SPEC:712-722): every drop
 * grouped by player in the frozen redraft order (seat 1 = worst first-half
 * standing), the released lines, the viewer's slots A/B/C with the real KOs
 * that transfer, the redraft budget and the order strip.
 *
 * Reads only `vm` (the snapshot after publish); no submission data.
 */
import { useId, useMemo } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/types/draft-queue';
import { entriesById, makeLineLabel } from './line-label';

export interface RedraftRevealProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
}

interface Drop {
  lineId: LineId;
  kills: number;
}

const CHIP = 'inline-flex items-center gap-1 rounded-full border border-poke-border px-2.5 py-1 text-xs';

export default function RedraftReveal({ vm, catalog }: RedraftRevealProps) {
  const t = useT(draftRedraftMessages);
  const tGlossary = useT(glossaryMessages);
  const dl = useDataLocale();
  const titleId = useId();
  const slotsId = useId();
  const orderId = useId();
  const label = useMemo(() => makeLineLabel(entriesById(catalog), dl), [catalog, dl]);

  const redraft = vm.redraft;
  const drops = useMemo(() => redraft?.drops ?? [], [redraft]);
  const byPlayer = useMemo(() => {
    const map = new Map<string, Drop[]>();
    for (const d of drops) {
      const list = map.get(d.player_id) ?? [];
      list.push({ lineId: d.line_id, kills: d.transferred_real_kills });
      map.set(d.player_id, list);
    }
    return map;
  }, [drops]);
  // Participants arrive in seat order: the frozen redraft order (worst first).
  const order = useMemo(() => [...vm.participants].sort((a, b) => a.seat - b.seat), [vm.participants]);
  const viewerSlots = vm.viewer.redraftSlots;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={titleId} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold">
            {t('reveal.title')}
          </h2>
          {redraft?.published_at ? (
            <p className="text-xs text-poke-text-secondary">
              {t('reveal.published')} <LocalTime value={redraft.published_at} preset="dateTime" />
            </p>
          ) : null}
        </div>
        <ol className="grid gap-3 sm:grid-cols-2">
          {order.map((p) => {
            const own = byPlayer.get(p.player_id) ?? [];
            return (
              <li
                key={p.player_id}
                className={`rounded-xl border p-3 ${p.isViewer ? 'border-poke-accent' : 'border-poke-border'} bg-poke-card`}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{p.name}</span>
                  {p.standing_rank !== null ? (
                    <span className="text-xs text-poke-text-secondary">{t('reveal.standing', { rank: p.standing_rank })}</span>
                  ) : null}
                </p>
                {own.length === 0 ? (
                  <p className="mt-1 text-sm text-poke-text-secondary">{t('reveal.noDrops')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {own.map((d) => (
                      <li key={d.lineId} className="flex flex-wrap justify-between gap-2">
                        <span>{label(d.lineId)}</span>
                        <span className="text-xs text-poke-text-secondary">
                          {t('panel.kosTransfer', { count: d.kills })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {drops.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('reveal.released')}</h3>
          <ul className="flex flex-wrap gap-2">
            {drops.map((d) => {
              const owner = vm.takenBy[d.line_id];
              return (
                <li key={`${d.player_id}:${d.line_id}`} className={CHIP}>
                  <span>{label(d.line_id)}</span>
                  <span className="text-poke-text-secondary">
                    {owner ? tGlossary('state.draftedBy', { name: owner.name || '–' }) : t('reveal.free')}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {viewerSlots.length > 0 ? (
        <section aria-labelledby={slotsId} className="flex flex-col gap-2">
          <h3 id={slotsId} className="text-sm font-semibold">
            {t('reveal.yourSlots')}
          </h3>
          <ul className="flex flex-col gap-2">
            {viewerSlots.map((s) => (
              <li
                key={s.redraftSlotId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-poke-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold">{t('reveal.slot', { label: s.label })}</span>{' '}
                  {t('reveal.replaces', { line: label(s.droppedLineId) })}
                </span>
                <span className="text-xs text-poke-text-secondary">
                  {t('panel.kosTransfer', { count: s.transferredRealKills })} ·{' '}
                  {s.open ? t('reveal.slotOpen') : t('reveal.slotFilled')}
                </span>
              </li>
            ))}
          </ul>
          {vm.viewer.budgetRemaining !== null ? (
            <p className="text-sm font-semibold tabular-nums">{t('reveal.budget', { n: vm.viewer.budgetRemaining })}</p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby={orderId} className="flex flex-col gap-2">
        <h3 id={orderId} className="text-sm font-semibold">
          {t('reveal.order')} · {tGlossary('draft.snakeOrder')}
        </h3>
        <ol className="flex flex-wrap gap-2">
          {order.map((p) => (
            <li key={p.player_id} className={`${CHIP} ${p.isViewer ? 'border-poke-accent font-semibold' : ''}`}>
              <span className="tabular-nums text-poke-text-secondary">{p.seat}.</span> {p.name}
            </li>
          ))}
        </ol>
        <p className="text-xs text-poke-text-secondary">{t('reveal.orderHint')}</p>
      </section>
    </div>
  );
}
