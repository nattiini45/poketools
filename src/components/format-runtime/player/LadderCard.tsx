'use client';

import { useId, useRef } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { makeChallengeRequest } from '@/lib/format-engine/runtime/client-api';
import type { ChallengeView, LadderView } from '@/lib/format-engine/runtime/view-types';
import ChallengeRow, { type LadderStatus } from './ChallengeRow';
import { FOCUS_TARGET, PLAYER_CARD, TrainerTile } from './parts';
import { useLText, usePlayerName } from './useLabels';
import { useRuntimeAction } from './useRuntimeAction';

const TOUCH = 'min-h-11 sm:min-h-0';

export interface LadderCardProps {
  seasonId: string;
  ladder: LadderView;
  viewerId: string;
  /** The league is completed or archived: nobody can be challenged and no challenge can be answered. */
  closed: boolean;
  /** The page's single reload path. */
  onReload: () => Promise<void>;
  /** Announces the outcome of a challenge or an answer (the page's polite live region). */
  onStatus?: (status: LadderStatus) => void;
}

/** Open challenges first, then the newest. */
function byImportance(a: ChallengeView, b: ChallengeView): number {
  const open = (c: ChallengeView) => (c.state === 'open' && !c.lapsed ? 0 : 1);
  return open(a) - open(b) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
}

/**
 * One challenge ladder: its rules, the ranked table with a Challenge button for each player the view says the viewer
 * may challenge (the others are disabled, with the reason written once under the table), and the viewer's own
 * challenges. The targets are a hint: the database decides, and a refused request shows its reason. A sent challenge
 * disables the button that was pressed, so focus moves to the heading of the viewer's challenges.
 */
export default function LadderCard({ seasonId, ladder, viewerId, closed, onReload, onStatus }: LadderCardProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const nameOf = usePlayerName();
  const errorText = useApiErrorText(errorsSeasons, errorsCommon);
  const { run, pending, error } = useRuntimeAction(onReload);
  const hintId = useId();
  const challengesHeadingRef = useRef<HTMLHeadingElement>(null);

  const title = ladder.stage_label !== null ? labelOf(ladder.stage_label) : t('ladder.title');
  const targets = new Set(ladder.targets);
  const challenges = [...ladder.challenges].sort(byImportance);
  const { config } = ladder;

  async function challenge(defenderId: string) {
    const outcome = await run(() => makeChallengeRequest(seasonId, ladder.phase_id, defenderId));
    if (outcome?.ok) {
      await onReload();
      challengesHeadingRef.current?.focus();
      onStatus?.('challengeSent');
    }
  }

  return (
    <article className={PLAYER_CARD} data-ladder={ladder.phase_id}>
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 className="text-subtitle font-[550] text-fg">{title}</h3>
          <SkewChip tone={ladder.my_rank !== null ? 'tier-1' : 'neutral'}>
            {ladder.my_rank !== null ? t('ladder.yourRank', { rank: ladder.my_rank }) : t('ladder.notRanked')}
          </SkewChip>
        </div>
        <p className="max-w-[75ch] text-caption text-fg-muted">
          {t('ladder.rules', {
            range: config.rank_range,
            max: config.max_open,
            hours: config.accept_window_hours,
            cooldown: config.cooldown_rounds,
          })}
        </p>
      </header>

      <div className="overflow-x-auto rounded-poke-md border border-hairline">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-elevated text-caption text-fg-muted">
            <tr>
              <th scope="col" className="w-px px-3 py-2 font-[550]">
                {t('ladder.rank')}
              </th>
              <th scope="col" className="px-3 py-2 font-[550]">
                {t('ladder.player')}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t('ladder.challenge')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ladder.table.map((row) => {
              const isViewer = row.player.id === viewerId;
              const name = nameOf(row.player);
              return (
                <tr key={row.player.id} className={isViewer ? 'bg-accent-subtle' : undefined}>
                  <td className="px-3 py-2 text-fg">
                    {row.rank >= 1 && row.rank <= 4 ? (
                      <SkewPlate variant="rank" tier={row.rank as 1 | 2 | 3 | 4} className="min-w-8 justify-center font-heading text-body tabular-nums">
                        {row.rank}
                      </SkewPlate>
                    ) : (
                      <span className="inline-block min-w-8 text-center font-heading text-body tabular-nums text-fg-muted">{row.rank}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg">
                    <span className="flex items-center gap-2">
                      <TrainerTile name={name} own={isViewer} />
                      <span className={cn('min-w-0 [overflow-wrap:break-word]', isViewer && 'font-[550]')}>{name}</span>
                      {isViewer && <SkewChip tone="accent">{t('ladder.you')}</SkewChip>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!isViewer && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className={TOUCH}
                        onClick={() => void challenge(row.player.id)}
                        disabled={closed || pending || !targets.has(row.player.id)}
                        aria-label={t('ladder.challengeAria', { name })}
                        aria-describedby={targets.has(row.player.id) ? undefined : hintId}
                      >
                        {t('ladder.challenge')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p id={hintId} className="max-w-[75ch] text-caption text-fg-muted">
        {ladder.round === null ? t('ladder.noRound') : ladder.my_rank === null ? t('ladder.notRankedHint') : t('ladder.outOfRange')}
      </p>

      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-col gap-2 border-t border-hairline pt-3">
        <h4 ref={challengesHeadingRef} tabIndex={-1} className={cn('self-start rounded-poke-sm text-body font-[550] text-fg', FOCUS_TARGET)}>
          {t('ladder.yours')}
        </h4>
        {challenges.length === 0 ? (
          <p className="text-body text-fg-muted">{t('ladder.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {challenges.map((entry) => (
              <ChallengeRow key={entry.id} seasonId={seasonId} challenge={entry} viewerId={viewerId} closed={closed} onReload={onReload} onStatus={onStatus} />
            ))}
          </ul>
        )}
        <p className="text-caption text-fg-muted">{t('ladder.noNotice')}</p>
      </div>
    </article>
  );
}
