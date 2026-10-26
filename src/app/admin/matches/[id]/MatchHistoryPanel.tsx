'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Section from '@/components/ui/Section';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { auditActionLabel } from '@/i18n/content/audit-actions';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { enumMessages } from '@/i18n/messages/enums';
import {
  MATCH_HISTORY_MAX_OFFSET,
  MATCH_HISTORY_PAGE_SIZE,
  type MatchHistoryEntry,
  type MatchHistoryPage,
} from '@/lib/admin/match-detail';
import {
  describeHistoryChanges,
  type HistoryChangeItem,
  type HistoryPlayer,
} from '@/lib/admin/match-history-view';

interface MatchHistoryPanelProps {
  matchId: string;
  /** The first page, read on the server. */
  initialPage: MatchHistoryPage;
  /** The server could not read the first page: show the load-failed notice with Retry. */
  loadFailed?: boolean;
  /** The two players of the match, to name the winner ids in `changes`. */
  players: HistoryPlayer[];
}

/** Whether another page can be asked for: some entries are still unseen and the route serves that offset. */
export function canLoadMoreHistory(shown: number, total: number): boolean {
  return shown < total && shown <= MATCH_HISTORY_MAX_OFFSET;
}

/** `entries` followed by the `incoming` ones it does not hold yet (a new event shifts the pages by one). */
export function appendHistoryEntries(
  entries: readonly MatchHistoryEntry[],
  incoming: readonly MatchHistoryEntry[],
): MatchHistoryEntry[] {
  const seen = new Set(entries.map((entry) => entry.id));
  return [...entries, ...incoming.filter((entry) => !seen.has(entry.id))];
}

function ChangeValue({ item, value }: { item: HistoryChangeItem; value: string | null }) {
  const t = useT(adminMatchMessages);
  const tEnums = useT(enumMessages);
  if (value === null) return <span className="text-poke-text-muted">{t('history.change.cleared')}</span>;
  switch (item.kind) {
    case 'status':
      return <>{enumLabel(tEnums, 'matchStatus', value)}</>;
    case 'scheduled':
      return <LocalTime value={value} preset="dateTimeYear" />;
    default:
      return <>{value}</>;
  }
}

function HistoryEntry({ entry, players }: { entry: MatchHistoryEntry; players: HistoryPlayer[] }) {
  const t = useT(adminMatchMessages);
  const tCore = useT(adminCoreMessages);
  const changes = describeHistoryChanges(entry.changes, players);

  return (
    <li className="px-3 py-2 bg-poke-surface-alt rounded-poke-md border border-poke-border text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-heading font-semibold text-poke-text-primary">
          {auditActionLabel(tCore, entry.action)}
        </span>
        <span className="text-poke-text-secondary">{entry.actor_name || t('history.unknownActor')}</span>
        <LocalTime value={entry.created_at} preset="dateTimeYear" className="text-xs text-poke-text-muted" />
      </div>
      {entry.reason && (
        <p className="mt-1 whitespace-pre-line text-poke-text-primary">
          <span className="text-poke-text-muted">{t('history.reason')}:</span> {entry.reason}
        </p>
      )}
      {changes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-poke-text-secondary">
          {changes.map((item) => (
            <li key={item.kind}>
              <span className="text-poke-text-muted">{t(`history.change.${item.kind}`)}:</span>{' '}
              <ChangeValue item={item} value={item.before} />{' → '}<ChangeValue item={item} value={item.after} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Everything recorded for the match and its games, newest first, loaded a page at a time. */
export default function MatchHistoryPanel({ matchId, initialPage, loadFailed = false, players }: MatchHistoryPanelProps) {
  const t = useT(adminMatchMessages);
  const [entries, setEntries] = useState(initialPage.entries);
  const [total, setTotal] = useState(initialPage.total);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(loadFailed);

  async function loadMore() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(
        `/api/admin/matches/${matchId}/history?offset=${entries.length}&limit=${MATCH_HISTORY_PAGE_SIZE}`,
      );
      const json = await res.json();
      if (json.success && json.data) {
        const page = json.data as MatchHistoryPage;
        setEntries((current) => appendHistoryEntries(current, page.entries));
        setTotal(page.total);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title={t('history.title')} collapsible keepMounted>
      {entries.length === 0 && !failed ? (
        <p className="text-sm text-poke-text-muted">{t('history.empty')}</p>
      ) : (
        <div className="space-y-3">
          {entries.length > 0 && (
            <>
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <HistoryEntry key={entry.id} entry={entry} players={players} />
                ))}
              </ul>
              <p className="text-xs text-poke-text-muted">
                {t('history.showing', { shown: entries.length, total })}
              </p>
            </>
          )}
          {failed && (
            <Alert variant="error">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('history.loadFailed')}</span>
                <Button variant="secondary" size="sm" onClick={loadMore} disabled={loading}>
                  {t('history.retry')}
                </Button>
              </div>
            </Alert>
          )}
          {!failed && canLoadMoreHistory(entries.length, total) && (
            <Button variant="secondary" size="sm" loading={loading} onClick={loadMore}>
              {loading ? t('history.loading') : t('history.loadMore')}
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
