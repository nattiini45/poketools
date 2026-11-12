'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { loadAdjustmentsRequest } from '@/lib/format-engine/runtime/client-api-admin';
import type { AdjustmentTargets, AdjustmentView } from '@/lib/format-engine/runtime/view-types';
import { speciesDisplayName } from '../player/entry-names';
import { CELL, NAME_CELL, ROW, TABLE, TABLE_FRAME, TBODY, TH, THEAD } from '@/components/admin/admin-table';
import { BUTTON_TOUCH, PAGE_SIZE, labelText, nameOf, type PlayerNames } from './admin-shared';
import { adjustmentFacts } from './adjustment-facts';
import { useAdminRequest } from './useAdminRequest';

export interface AdjustmentHistoryProps {
  seasonId: string;
  /** The first page, newest first, read by the server page. */
  initial: readonly AdjustmentView[];
  total: number;
  /** The labels of stages, resources, relations and actions. */
  targets: AdjustmentTargets;
  names: PlayerNames;
}

/** The newest adjustments first, with the rest on demand. A page read again by the server replaces what was loaded. */
export default function AdjustmentHistory({ seasonId, initial, total, targets, names }: AdjustmentHistoryProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const { pending, errorMessage, run } = useAdminRequest();
  const [seen, setSeen] = useState(initial);
  const [more, setMore] = useState<AdjustmentView[]>([]);
  if (seen !== initial) {
    // The server page was read again (after a write): its rows are the truth, what was paged in is out of date.
    setSeen(initial);
    setMore([]);
  }

  const rows = [...initial, ...more];
  const player = (id: string): string => nameOf(names, id) ?? t('formerPlayer');
  const stage = (key: string): string => labelText(targets.stages.find((s) => s.key === key)?.label, locale, key);
  const resource = (key: string): string => labelText(targets.resources.find((r) => r.key === key)?.label, locale, key);
  const relation = (key: string): string => labelText(targets.relations.find((r) => r.key === key)?.label, locale, key);
  const action = (key: string): string => labelText(targets.actions.find((a) => a.id === key)?.label, locale, key);

  function summary(row: AdjustmentView): string {
    const facts = adjustmentFacts(row);
    switch (facts.kind) {
      case 'points':
        return t('adjust.history.points', { points: facts.points, player: player(facts.player), stage: stage(facts.stage) });
      case 'rank':
        return t('adjust.history.rank', { count: facts.players, stage: stage(facts.stage) });
      case 'resource': {
        const what = facts.item === null ? resource(facts.resource) : `${speciesDisplayName(facts.item, dataLocale)} (${resource(facts.resource)})`;
        return facts.amount >= 0
          ? t('adjust.history.resourceGrant', { amount: facts.amount, what, player: player(facts.player) })
          : t('adjust.history.resourceRevoke', { amount: Math.abs(facts.amount), what, player: player(facts.player) });
      }
      case 'relation': {
        const parts: string[] = [];
        if (facts.draw) parts.push(t('adjust.history.relationDraw', { relation: relation(facts.relation), count: facts.linkCount ?? 0 }));
        else if (facts.linkCount !== null) parts.push(t('adjust.history.relationLinks', { relation: relation(facts.relation), count: facts.linkCount }));
        if (facts.reveal) parts.push(t('adjust.history.relationReveal', { relation: relation(facts.relation) }));
        return parts.length > 0 ? parts.join('; ') : t('adjust.history.unknown');
      }
      case 'action':
        return facts.state === 'open'
          ? t('adjust.history.actionOpen', { action: action(facts.action) })
          : t('adjust.history.actionLock', { action: action(facts.action) });
      case 'domain':
        return t('adjust.history.domain', { domain: facts.domain, added: facts.added, removed: facts.removed });
      case 'outcome':
        return t('adjust.history.outcome');
      case 'unknown':
        return t('adjust.history.unknown');
    }
  }

  async function loadMore() {
    const out = await run(() => loadAdjustmentsRequest(seasonId, { limit: PAGE_SIZE, offset: rows.length }));
    if (!out.ok) return;
    // The list is newest first and paged by offset: an adjustment recorded meanwhile (by another admin, or in another
    // tab) shifts the list down, so the next page can repeat a row that is already shown. Keep each row once.
    setMore((prev) => {
      const shown = new Set([...initial, ...prev].map((row) => row.id));
      return [...prev, ...out.data.history.filter((row) => !shown.has(row.id))];
    });
  }

  if (rows.length === 0) {
    return <p className="text-body text-fg-muted">{t('adjust.history.empty')}</p>;
  }

  return (
    <div className="space-y-3" data-live-adjustment-history>
      <div className={TABLE_FRAME} role="region" aria-label={t('adjust.history.caption')} tabIndex={0}>
        <table className={TABLE}>
          <caption className="sr-only">{t('adjust.history.caption')}</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH}>{t('adjust.history.columns.kind')}</th>
              <th scope="col" className={TH}>{t('adjust.history.columns.what')}</th>
              <th scope="col" className={TH}>{t('adjust.history.columns.reason')}</th>
              <th scope="col" className={TH}>{t('adjust.history.columns.admin')}</th>
              <th scope="col" className={TH}>{t('adjust.history.columns.when')}</th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {rows.map((row) => (
              <tr key={row.id} className={ROW}>
                <td className={NAME_CELL}>{t(`adjust.kind.${row.kind}`)}</td>
                <td className={CELL} data-label={t('adjust.history.columns.what')}>{summary(row)}</td>
                <td className={CELL} data-label={t('adjust.history.columns.reason')}>{row.reason}</td>
                <td className={CELL} data-label={t('adjust.history.columns.admin')}>
                  {row.admin === null ? t('adjust.history.system') : (row.admin.name ?? t('formerPlayer'))}
                </td>
                <td className={CELL} data-label={t('adjust.history.columns.when')}>
                  <LocalTime value={row.created_at} preset="dateTimeYear" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errorMessage !== null && <Alert variant="error">{errorMessage}</Alert>}
      {rows.length < total && (
        <Button variant="ghost" size="sm" className={BUTTON_TOUCH} loading={pending} onClick={() => void loadMore()}>
          {t('adjust.history.more')}
        </Button>
      )}
    </div>
  );
}
