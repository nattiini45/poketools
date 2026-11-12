'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
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

/** The step plate's colour: finished steps in the accent, open ones in gold, blocked ones in red. */
const STATE_TONE: Record<StartupItemState, SkewChipTone> = {
  done: 'accent',
  blocked: 'loss',
  attention: 'tier-1',
  unknown: 'neutral',
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
      className="rounded-poke-lg border border-hairline bg-surface p-4"
    >
      <h3 id={titleId} className="text-subtitle font-[550] text-fg">
        {t('checklist.title')}
      </h3>
      <ol className="mt-3 flex flex-col">
        {checklist.items.map((item, index) => {
          const Icon = STATE_ICON[item.state];
          const href = item.link ? links[item.link] : undefined;
          const showLink = Boolean(href) && item.state !== 'done' && item.state !== 'unknown';
          const unknownText = item.state === 'unknown' ? statusText(status === 'error' ? 'error' : 'loading') : null;
          return (
            <li
              key={item.id}
              data-item={item.id}
              data-state={item.state}
              className="relative flex items-start gap-3 pb-3 text-body text-fg last:pb-0"
            >
              {index < checklist.items.length - 1 && (
                <span aria-hidden="true" className="absolute bottom-0 left-4 top-6 w-px bg-hairline-strong" />
              )}
              <SkewChip tone={STATE_TONE[item.state]} className="shrink-0">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </SkewChip>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span>{unknownText ?? t.dynamic(messageKey(item), messageParams(item, locale))}</span>
                {item.id === 'seeding' && (
                  <Badge variant="gray" size="xs">
                    {t('checklist.optional')}
                  </Badge>
                )}
                {showLink && href && (
                  <Link
                    href={href}
                    className="font-[550] text-accent-ink underline underline-offset-2 hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {t.dynamic(`checklist.${item.id}.action`)}
                  </Link>
                )}
                {item.state === 'unknown' && status === 'error' && retry}
              </div>
            </li>
          );
        })}
      </ol>
      {statusLine && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-body text-fg-muted">
          <span>{statusText(statusLine)}</span>
          {statusLine === 'error' && retry}
        </div>
      )}
      {checklist.blocked && <p className="mt-3 text-caption text-fg-muted">{t('checklist.blockedNote')}</p>}
    </div>
  );
}
