'use client';

import { useId } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Hourglass } from 'lucide-react';
import WorkspaceCard from '@/components/admin/WorkspaceCard';
import { useT } from '@/i18n/client';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { ReadinessItem, ReadinessResult, ReadinessState } from '@/lib/format-studio/editor/readiness';

interface ReadinessCardProps {
  result: ReadinessResult;
  seasonId: string;
  /** The id of the card's heading (also what the section is labelled by). Defaults to a generated id. */
  labelledBy?: string;
  /** The id of the card itself, for in-page links. */
  id?: string;
  /** The level of the card's heading: 2 beside `Section` titles (the default). */
  headingLevel?: 2 | 3;
}

const STATE_ICON: Record<ReadinessState, typeof Circle> = {
  met: CheckCircle2,
  unmet: Circle,
  waiting: Hourglass,
};

const STATE_TONE: Record<ReadinessState, string> = {
  met: 'text-win',
  unmet: 'text-accent-ink',
  waiting: 'text-fg-muted',
};

/** The link of an item: the tab it is fixed on, plus the anchor of the control when there is one. */
export function readinessHref(seasonId: string, action: NonNullable<ReadinessItem['action']>): string {
  const base = leagueAdminHref(seasonId, action.tab);
  return action.anchor === undefined ? base : `${base}#${action.anchor}`;
}

/**
 * The "Ready to start?" checklist of a custom league. It reads as text first: every item says Done, To do or
 * Waiting in words, the icon is decoration. An item still to do links to where it is fixed. A league that is ready
 * gets one line instead of the list; a league that is not custom gets nothing (the card renders `null`).
 */
export default function ReadinessCard({ result, seasonId, labelledBy, id, headingLevel = 2 }: ReadinessCardProps) {
  const t = useT(formatStudioAttachMessages);
  const generated = useId();
  const headingId = labelledBy ?? `readiness-${generated}`;
  if (!result.applicable) return null;

  function sentence(item: ReadinessItem): string {
    if (item.state === 'waiting') return t.dynamic(`readiness.${item.id}.waiting`);
    const manual = Number(item.params.manual ?? 0);
    if (item.id === 'phases_created' && item.state === 'unmet' && manual > 0) {
      return t.dynamic('readiness.phases_created.unmetManual', { ...item.params, count: manual });
    }
    return t.dynamic(`readiness.${item.id}.${item.state}`, item.params);
  }

  function actionLabel(item: ReadinessItem): string {
    const manual = item.id === 'phases_created' && item.action?.tab === 'phases';
    return t.dynamic(`readiness.action.${manual ? 'phases_manual' : item.id}`);
  }

  const done = result.items.filter((item) => item.state === 'met').length;
  const total = result.items.length;

  return (
    <WorkspaceCard
      id={id}
      headingId={headingId}
      headingLevel={headingLevel}
      icon="rare-candy"
      title={t('readiness.title')}
      aside={
        !result.ready && total > 0 ? (
          <span className="shrink-0 font-heading text-title text-fg-muted tabular-nums">{t('readiness.progress', { done, total })}</span>
        ) : undefined
      }
      data-readiness={result.ready ? 'ready' : 'open'}
    >
      <p className="text-body text-fg-muted">{t('readiness.intro')}</p>
      {result.ready ? (
        <p role="status" className="mt-3 flex items-start gap-2 text-body font-[550] text-win">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('readiness.ready')}</span>
        </p>
      ) : (
        <>
          {/* The count beside the title says the same in words; the bar is decoration. */}
          {total > 0 && (
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent-fill" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
          <ol className="mt-2 divide-y divide-hairline">
            {result.items.map((item) => {
              const Icon = STATE_ICON[item.state];
              return (
                <li key={item.id} className="flex min-w-0 items-start gap-2.5 py-3 last:pb-0" data-readiness-item={item.id} data-state={item.state}>
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STATE_TONE[item.state]}`} aria-hidden="true" />
                  <div className="min-w-0 space-y-1 text-body">
                    <p className="break-words text-fg">
                      <span className="font-[550]">{t(`readiness.state.${item.state}`)}: </span>
                      {sentence(item)}
                    </p>
                    {item.state === 'unmet' && item.action !== null && (
                      <Link
                        href={readinessHref(seasonId, item.action)}
                        className="inline-flex min-h-11 items-center font-[550] text-accent-ink hover:underline sm:min-h-0"
                      >
                        {actionLabel(item)}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </WorkspaceCard>
  );
}
