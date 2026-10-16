'use client';

/**
 * The audit trail viewer (draft-frontend §7.3; acceptance item 20). Reads BE
 * #15 (admin-guarded, includes non-public rows) page by page with "Load
 * more". Filters: pool, actions (multi-select), player.
 *
 * Read-only by design (SPEC:973): there is no edit and no delete control, and
 * this module imports no write action.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { LocalTime } from '@/i18n/LocalTime';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { PublicPlayerRef } from '@/lib/players/public-player';
import {
  DRAFT_AUDIT_ACTIONS,
  type AdminPoolSummary,
  type AuditEntryDTO,
  type DraftAuditAction,
  type LineId,
} from '@/types/draft-queue';
import { useLineText } from '@/components/draft-tokens/use-line-text';
import { adminCall, auditQueryString, isAuditPage, type AuditPage } from './admin-actions';
import { FIELD, HINT, InlineError, LABEL, TABLE, TD, TH } from './admin-ui';
import { auditChanges, poolTabs } from './admin-view';

export interface DraftAuditViewerProps {
  seasonId: string;
  pools: AdminPoolSummary[];
  initialPoolId: string;
  /** Player filter options (`toPublicPlayerRef`, id + name only). */
  participants: PublicPlayerRef[];
  /** Line labels. */
  catalog: DraftLineCatalog;
  initialActions?: DraftAuditAction[];
  initialPlayer?: string | null;
  /** Test injection; default = BE #15 over `fetch`. */
  loadPage?(poolId: string, query: string): Promise<{ ok: true; data: AuditPage } | { ok: false }>;
}

const PAGE_SIZE = 50;

function defaultLoadPage(poolId: string, query: string) {
  return adminCall(`/api/drafts/${encodeURIComponent(poolId)}/audit?${query}`, 'GET', undefined, isAuditPage);
}

type Status = 'loading' | 'ready' | 'error';

interface Filters {
  poolId: string;
  actions: DraftAuditAction[];
  player: string | null;
}

/** One audit row's cells (exported for tests). */
export function AuditRow({ entry, lineLabel }: { entry: AuditEntryDTO; lineLabel(lineId: LineId): string }) {
  const t = useT(draftAdminMessages);
  const { pairs, more } = auditChanges(entry.before, entry.after);
  const actionKey = `audit.action.${entry.action}`;
  return (
    <tr className="border-t border-poke-border">
      <td className={TD}>
        <LocalTime value={entry.occurred_at} preset="dateTimeYear" zone="both" />
      </td>
      <td className={TD}>
        <span>{entry.actor.role === 'system' ? t('audit.system') : entry.actor.name}</span>{' '}
        <span className="rounded-poke-sm border border-poke-border px-1 text-xs text-poke-text-secondary">
          {t(`audit.role.${entry.actor.role}`)}
        </span>
      </td>
      <td className={TD}>{t.dynamic(actionKey, undefined, entry.action)}</td>
      <td className={TD}>{entry.player_name ?? ''}</td>
      <td className={TD}>{entry.line_id ? lineLabel(entry.line_id) : ''}</td>
      <td className={TD}>
        {entry.pick_number !== null && entry.slot_label
          ? t('audit.pickSlot', { n: entry.pick_number, label: entry.slot_label })
          : entry.pick_number !== null
            ? t('audit.pick', { n: entry.pick_number })
            : entry.slot_label
              ? t('audit.slot', { label: entry.slot_label })
              : null}
      </td>
      <td className={TD}>
        <ul className="space-y-0.5 font-mono text-xs">
          {pairs.map((p) => (
            <li key={p.key}>{t('audit.change', { key: p.key, from: p.from, to: p.to })}</li>
          ))}
          {more > 0 ? <li>{t('audit.more', { n: more })}</li> : null}
        </ul>
      </td>
      <td className={TD}>{entry.note ?? ''}</td>
    </tr>
  );
}

export default function DraftAuditViewer({
  seasonId,
  pools,
  initialPoolId,
  participants,
  catalog,
  initialActions = [],
  initialPlayer = null,
  loadPage = defaultLoadPage,
}: DraftAuditViewerProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const text = useLineText(catalog);
  const poolId = useId();
  const playerId = useId();
  const tabs = useMemo(() => poolTabs(pools), [pools]);

  const [filters, setFilters] = useState<Filters>({ poolId: initialPoolId, actions: initialActions, player: initialPlayer });
  const [entries, setEntries] = useState<AuditEntryDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [moreBusy, setMoreBusy] = useState(false);

  const query = (after: string | null) =>
    auditQueryString({ actions: filters.actions, player: filters.player, cursor: after, limit: PAGE_SIZE });

  useEffect(() => {
    let cancelled = false;
    const q = auditQueryString({ actions: filters.actions, player: filters.player, limit: PAGE_SIZE });
    void loadPage(filters.poolId, q).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setEntries(res.data.entries);
        setCursor(res.data.next_cursor);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filters, loadPage]);

  const update = (next: Partial<Filters>) => {
    setStatus('loading');
    setFilters((prev) => ({ ...prev, ...next }));
  };

  const toggleAction = (action: DraftAuditAction, on: boolean) => {
    const set = new Set(filters.actions);
    if (on) set.add(action);
    else set.delete(action);
    update({ actions: DRAFT_AUDIT_ACTIONS.filter((a) => set.has(a)) });
  };

  const loadMore = async () => {
    if (!cursor) return;
    setMoreBusy(true);
    const res = await loadPage(filters.poolId, query(cursor));
    setMoreBusy(false);
    if (res.ok) {
      setEntries((prev) => [...prev, ...res.data.entries]);
      setCursor(res.data.next_cursor);
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="space-y-4" data-season={seasonId}>
      <p className={HINT}>{t('audit.readOnly')}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={poolId} className={LABEL}>
            {t('audit.filters.pool')}
          </label>
          <select
            id={poolId}
            value={filters.poolId}
            onChange={(e) => update({ poolId: e.target.value })}
            className={FIELD}
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.kind === 'initial' ? tGlossary('draft.initialDraft') : t('panel.tabRedraft', { n: tab.redraftNo })}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <p className={LABEL}>{t('audit.filters.actions')}</p>
          <details className="rounded-poke-md border border-poke-border bg-poke-surface text-sm">
            <summary className="cursor-pointer px-3 py-2">
              {filters.actions.length === 0
                ? t('audit.filters.allActions')
                : t('audit.filters.selected', { count: filters.actions.length })}
            </summary>
            <fieldset className="min-w-0 max-h-64 space-y-1 overflow-y-auto px-3 pb-2">
              <legend className="sr-only">{t('audit.filters.actions')}</legend>
              {DRAFT_AUDIT_ACTIONS.map((action) => (
                <label key={action} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.actions.includes(action)}
                    onChange={(e) => toggleAction(action, e.target.checked)}
                  />
                  {t(`audit.action.${action}`)}
                </label>
              ))}
            </fieldset>
          </details>
        </div>

        <div className="space-y-1">
          <label htmlFor={playerId} className={LABEL}>
            {t('audit.filters.player')}
          </label>
          <select
            id={playerId}
            value={filters.player ?? ''}
            onChange={(e) => update({ player: e.target.value || null })}
            className={FIELD}
          >
            <option value="">{t('audit.filters.allPlayers')}</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filters.actions.length > 0 || filters.player ? (
        <Button size="sm" variant="ghost" onClick={() => update({ actions: [], player: null })}>
          {t('audit.filters.reset')}
        </Button>
      ) : null}

      {status === 'error' ? <InlineError text={t('audit.loadFailed')} /> : null}
      {status === 'loading' ? <p className={HINT}>{t('audit.loading')}</p> : null}
      {status === 'ready' && entries.length === 0 ? <p className={HINT}>{t('audit.empty')}</p> : null}

      {/* After a filter change the old page is hidden until the new one arrives. */}
      {status !== 'loading' && entries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>{t('audit.col.time')}</th>
                <th className={TH}>{t('audit.col.actor')}</th>
                <th className={TH}>{t('audit.col.action')}</th>
                <th className={TH}>{t('audit.col.player')}</th>
                <th className={TH}>{t('audit.col.line')}</th>
                <th className={TH}>{t('audit.col.pick')}</th>
                <th className={TH}>{t('audit.col.change')}</th>
                <th className={TH}>{t('audit.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} lineLabel={text.label} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {cursor && status === 'ready' ? (
        <Button variant="secondary" disabled={moreBusy} onClick={loadMore}>
          {moreBusy ? t('audit.loading') : t('audit.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
