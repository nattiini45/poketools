'use client';

import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { LateJoinerView, MissedEffect, MissedEvent } from '@/lib/format-engine/runtime/view-types';
import ScrollRegion from '../ScrollRegion';
import { labelText } from './admin-shared';

export interface LateJoinersProps {
  lateJoiners: readonly LateJoinerView[];
}

/**
 * The players added to a stage after its one-time events had fired, and for each the events that did nothing for them (a
 * grant, points, an attribute or a relation draw made for the roster the stage started with). The server built the list
 * with the masks of the admin overview, so what it leaves out is not asked for here. Read only: the admin makes good with
 * an adjustment.
 */
export default function LateJoiners({ lateJoiners }: LateJoinersProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();

  if (lateJoiners.length === 0) return null;

  const stageName = (event: MissedEvent): string =>
    event.stage === null ? t('lateJoiners.anyStage') : labelText(event.stage_label, locale, event.stage);

  const eventText = (event: MissedEvent): string => {
    switch (event.event) {
      case 'stage_start':
      case 'stage_end':
        return t(`lateJoiners.event.${event.event}`, { stage: stageName(event) });
      case 'round_start':
      case 'round_end':
        return t(`lateJoiners.event.${event.event}`, { stage: stageName(event), round: event.round ?? 0 });
      case 'action_locked':
        return t('lateJoiners.event.action_locked', { action: event.action ?? '' });
      case 'time':
        return t('lateJoiners.event.time', { stage: stageName(event), mark: event.mark ?? '' });
    }
  };

  const effectText = (effect: MissedEffect): string => t(`lateJoiners.effect.${effect.kind}`, { name: labelText(effect.label, locale, effect.key) });

  return (
    <ScrollRegion label={t('lateJoiners.caption')} data-live-late-joiners>
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">{t('lateJoiners.caption')}</caption>
        <thead className="bg-poke-muted text-xs font-heading text-poke-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-2">{t('lateJoiners.columns.player')}</th>
            <th scope="col" className="px-3 py-2">{t('lateJoiners.columns.missed')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-poke-border">
          {lateJoiners.map((joiner) => (
            <tr key={joiner.player.id}>
              <th scope="row" className="px-3 py-2 align-top font-normal text-poke-text-primary">
                {joiner.player.name ?? t('formerPlayer')}
              </th>
              <td className="px-3 py-2">
                <ul className="space-y-2">
                  {joiner.missed.map((event, index) => (
                    <li key={`${event.event}-${event.stage ?? 'x'}-${event.round ?? 'x'}-${event.action ?? 'x'}-${event.mark ?? 'x'}-${index}`} className="space-y-1">
                      <p className="text-poke-text-primary">{eventText(event)}</p>
                      <p className="flex flex-wrap gap-1">
                        {event.effects.map((effect) => (
                          <Badge key={`${effect.kind}-${effect.key}`} variant="gray">
                            {effectText(effect)}
                          </Badge>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
