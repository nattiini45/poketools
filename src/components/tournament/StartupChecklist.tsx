'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import type {
  StartupChecklist,
  StartupItem,
  StartupItemState,
  StartupLinkTarget,
} from '@/lib/tournament/startup-checklist';

/** Prefix of the checklist region's DOM id; the round manager appends the tournament id. */
export const STARTUP_CHECKLIST_REGION_ID_PREFIX = 'startup-checklist-';

/** Where each link target points (an anchor on the page or a route); a missing target renders no link. */
export type StartupChecklistLinks = Partial<Record<StartupLinkTarget, string>>;

export type StartupChecklistStatus = 'loading' | 'ready' | 'error';

interface StartupChecklistViewProps {
  checklist: Pick<StartupChecklist, 'items' | 'blocked'>;
  links: StartupChecklistLinks;
  /** State of the participant read the checklist depends on. */
  status: StartupChecklistStatus;
  onRetry: () => void;
  /** DOM id of the region, so the Generate buttons can point `aria-describedby` at it. */
  id?: string;
}

const STATE_ICON: Record<StartupItemState, typeof CheckCircle2> = {
  done: CheckCircle2,
  blocked: XCircle,
  attention: AlertTriangle,
  unknown: CircleDashed,
};

const STATE_ICON_CLASS: Record<StartupItemState, string> = {
  done: 'text-poke-green',
  blocked: 'text-poke-danger',
  attention: 'text-poke-yellow-ink',
  unknown: 'text-poke-text-muted',
};

/** Catalog key of an item's message; `roundsRemaining` is `checklist.rounds.*` and its blocked row is `rounds.allGenerated`. */
function messageKey(item: StartupItem): string {
  if (item.id === 'roundsRemaining') {
    if (item.state === 'blocked') return 'rounds.allGenerated';
    return item.state === 'attention' ? 'checklist.rounds.gap' : 'checklist.rounds.done';
  }
  if (item.id === 'ruleset' && item.state === 'done' && item.params.name === undefined) {
    return 'checklist.ruleset.doneUnnamed';
  }
  return `checklist.${item.id}.${item.state}`;
}

/** Values for an item's message: the plural count is the number the sentence is about. */
function messageParams(item: StartupItem, locale: Locale): Record<string, string | number> {
  const params: Record<string, string | number> = { ...item.params };
  if (item.id === 'seeding' && typeof item.params.unseeded === 'number') params.count = item.params.unseeded;
  if (item.id === 'roundsRemaining' && item.state === 'blocked') params.count = item.params.total ?? 0;
  if (item.id === 'previousRound' && typeof item.params.round === 'string') {
    params.round = translateEngineLabel('round', item.params.round, locale);
  }
  return params;
}

/**
 * The round manager's "Before you generate" list: one row per checklist item with its state, a sentence from
 * the `checklist.*` catalog and, for an unmet item, a link to the control that fixes it. Presentational: the
 * pure `buildStartupChecklist` decides the items; only a blocked item disables Generate.
 */
export function StartupChecklistView({
  checklist,
  links,
  status,
  onRetry,
  id = `${STARTUP_CHECKLIST_REGION_ID_PREFIX}default`,
}: StartupChecklistViewProps) {
  const t = useT(tournamentsAdminMessages);
  const locale = useLocale();
  const titleId = `${id}-title`;
  const hasUnknownRow = checklist.items.some((item) => item.state === 'unknown');
  // The unknown participants row carries the loading / failed text; with no such row the status gets its own line.
  const statusLine = status === 'ready' || hasUnknownRow ? null : status;

  function statusText(which: 'loading' | 'error'): string {
    return which === 'error' ? t('checklist.loadFailed') : t('checklist.checking');
  }

  const retry = (
    <Button variant="ghost" size="sm" onClick={onRetry}>
      {t('rounds.retry')}
    </Button>
  );

  return (
    <div
      id={id}
      role="region"
      aria-labelledby={titleId}
      className="rounded-poke-md border border-poke-border bg-poke-surface p-3 space-y-2"
    >
      <h3 id={titleId} className="font-heading font-semibold text-sm text-poke-text-primary">
        {t('checklist.title')}
      </h3>
      <ul className="space-y-1.5">
        {checklist.items.map((item) => {
          const Icon = STATE_ICON[item.state];
          const href = item.link ? links[item.link] : undefined;
          const showLink = Boolean(href) && item.state !== 'done' && item.state !== 'unknown';
          const unknownText = item.state === 'unknown' ? statusText(status === 'error' ? 'error' : 'loading') : null;
          return (
            <li
              key={item.id}
              data-item={item.id}
              data-state={item.state}
              className="flex items-start gap-2 text-sm text-poke-text-primary"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STATE_ICON_CLASS[item.state]}`} aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{unknownText ?? t.dynamic(messageKey(item), messageParams(item, locale))}</span>
                {item.id === 'seeding' && (
                  <Badge variant="gray" size="xs">
                    {t('checklist.optional')}
                  </Badge>
                )}
                {showLink && href && (
                  <Link
                    href={href}
                    className="text-poke-accent underline underline-offset-2 hover:text-poke-accent-strong"
                  >
                    {t.dynamic(`checklist.${item.id}.action`)}
                  </Link>
                )}
                {item.state === 'unknown' && status === 'error' && retry}
              </div>
            </li>
          );
        })}
      </ul>
      {statusLine && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-poke-text-muted">
          <span>{statusText(statusLine)}</span>
          {statusLine === 'error' && retry}
        </div>
      )}
      {checklist.blocked && <p className="text-xs text-poke-text-muted">{t('checklist.blockedNote')}</p>}
    </div>
  );
}
