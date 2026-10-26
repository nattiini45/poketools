'use client';

import { useId } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Hourglass } from 'lucide-react';
import Card from '@/components/ui/Card';
import { useT } from '@/i18n/client';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { ReadinessItem, ReadinessResult, ReadinessState } from '@/lib/format-studio/editor/readiness';
import { Heading } from '../headingLevel';

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
  met: 'text-poke-green',
  unmet: 'text-poke-yellow-ink',
  waiting: 'text-poke-text-muted',
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

  return (
    <section id={id} aria-labelledby={headingId} data-readiness={result.ready ? 'ready' : 'open'}>
      <Card className="space-y-3">
        <div>
          <Heading level={headingLevel} className="text-lg font-heading font-bold tracking-tight text-poke-text-primary">
            <span id={headingId}>{t('readiness.title')}</span>
          </Heading>
          <p className="mt-1 text-sm text-poke-text-secondary">{t('readiness.intro')}</p>
        </div>
        {result.ready ? (
          <p role="status" className="flex items-start gap-2 text-sm font-medium text-poke-green">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('readiness.ready')}</span>
          </p>
        ) : (
          <ol className="space-y-3">
            {result.items.map((item) => {
              const Icon = STATE_ICON[item.state];
              return (
                <li key={item.id} className="flex min-w-0 items-start gap-2" data-readiness-item={item.id} data-state={item.state}>
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STATE_TONE[item.state]}`} aria-hidden="true" />
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="break-words text-poke-text-primary">
                      <span className="font-heading font-semibold">{t(`readiness.state.${item.state}`)}: </span>
                      {sentence(item)}
                    </p>
                    {item.state === 'unmet' && item.action !== null && (
                      <Link
                        href={readinessHref(seasonId, item.action)}
                        className="inline-flex min-h-11 items-center font-medium text-poke-blue hover:underline sm:min-h-0"
                      >
                        {actionLabel(item)}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </section>
  );
}
