'use client';

import { useCallback, useRef, useState } from 'react';
import Alert from '@/components/ui/Alert';
import ItemIcon from '@/components/ui/ItemIcon';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { loadMyFormatView } from '@/lib/format-engine/runtime/client-api';
import type { PlayerFormatView as PlayerFormatViewData } from '@/lib/format-engine/runtime/view-types';
import type { ActionStatus } from './ActionCard';
import ActionsSection from './ActionsSection';
import type { LadderStatus } from './ChallengeRow';
import ItemsSection from './ItemsSection';
import LadderSection from './LadderSection';
import RelationsSection from './RelationsSection';

export interface PlayerFormatViewProps {
  seasonId: string;
  /** The viewer's own player id (the view fills it in on their side of a link; it is the viewer's own, not a secret). */
  viewerId: string;
  /** The view the server rendered the page with. */
  initialView: PlayerFormatViewData;
  /** The league is completed or archived: everything is shown, nothing can be changed. */
  closed: boolean;
}

type Status = ActionStatus | LadderStatus | 'reloading';

/**
 * The player's page of a running custom league. It owns the `view`; the ONLY way the view is refreshed is `reload()`
 * (one request to `GET .../format/me`), which every card calls after a write and after a stale answer. There is no
 * `router.refresh()` here, so the page can never show two different versions of the league.
 *
 * Results are announced in a polite live region; the text is picked from a stored key at render time, so a language
 * switch re-renders it.
 */
export default function PlayerFormatView({ seasonId, viewerId, initialView, closed }: PlayerFormatViewProps) {
  const t = useT(formatRuntimePlayerMessages);
  const [view, setView] = useState<PlayerFormatViewData>(initialView);
  const [status, setStatus] = useState<Status | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  // Only the newest reload may write its answer; an older one reports what the newest reports.
  const ticket = useRef(0);
  const newest = useRef<Promise<boolean>>(Promise.resolve(true));

  /** Reads the view again. Resolves to whether that worked (`false`: the old view is still shown). */
  const reload = useCallback((): Promise<boolean> => {
    const mine = ++ticket.current;
    setStatus('reloading');
    const read = (async (): Promise<boolean> => {
      const outcome = await loadMyFormatView(seasonId);
      if (mine !== ticket.current) return newest.current;
      if (outcome.ok) {
        setView(outcome.data);
        setReloadFailed(false);
      } else {
        setReloadFailed(true);
      }
      setStatus(null);
      return outcome.ok;
    })();
    newest.current = read;
    return read;
  }, [seasonId]);
  // The ladder cards only need to wait for the read.
  const reloadQuietly = useCallback(async (): Promise<void> => {
    await reload();
  }, [reload]);

  const announce = useCallback((next: ActionStatus | LadderStatus) => setStatus(next), []);

  if (!view.running) {
    return <Alert variant="info">{t('page.notRunning')}</Alert>;
  }

  const hasRelations = view.relations.length > 0;
  const hasItems = view.items.length > 0;
  const empty = view.actions.length === 0 && !hasRelations && !hasItems && view.ladders.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div role="status" aria-live="polite" className="-mb-3 min-h-5 text-body text-fg-muted" data-player-status>
        {status === null ? '' : t(`status.${status}`)}
      </div>
      {reloadFailed && <Alert variant="warning">{t('status.reloadFailed')}</Alert>}
      {empty && (
        <div className="flex items-center gap-4 rounded-poke-lg border border-hairline bg-surface p-4 sm:p-5">
          <ItemIcon item="poke-doll" size={48} />
          <p className="text-body text-fg-muted">{t('page.empty')}</p>
        </div>
      )}
      {view.actions.length > 0 && (
        <ActionsSection seasonId={seasonId} actions={view.actions} domains={view.domains} closed={closed} onReload={reload} onStatus={announce} />
      )}
      {hasRelations && <RelationsSection relations={view.relations} viewerId={viewerId} />}
      {hasItems && <ItemsSection items={view.items} />}
      {view.ladders.length > 0 && (
        <LadderSection seasonId={seasonId} ladders={view.ladders} viewerId={viewerId} closed={closed} onReload={reloadQuietly} onStatus={announce} />
      )}
    </div>
  );
}
