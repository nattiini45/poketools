'use client';

import { useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { cn } from '@/lib/utils/cn';

export type MatchResultLetter = 'W' | 'L' | 'D';

const TONE: Record<MatchResultLetter, string> = {
  W: 'bg-win-bg text-win',
  L: 'bg-loss-bg text-loss',
  D: 'bg-surface text-fg-muted',
};

/** The win, loss or draw token of a form row or a match row: the short letter on its status wash, named in full by its title. */
export default function ResultToken({ result, className }: { result: MatchResultLetter; className?: string }) {
  const t = useT(commonMessages);
  const full = { W: t('record.win'), L: t('record.loss'), D: t('record.draw') }[result];
  const short = { W: t('record.winShort'), L: t('record.lossShort'), D: t('record.drawShort') }[result];
  return (
    <span
      title={full}
      className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] font-mono text-micro font-[550]', TONE[result], className)}
    >
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
