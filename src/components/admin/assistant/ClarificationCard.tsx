'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { PANEL_INSET } from '@/components/ui/panel';
import { useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import type { ClarificationView } from './types';

export interface ClarificationCardProps {
  clarification: ClarificationView;
  /** The admin has written since the question was asked. */
  answered: boolean;
  /** Sends the answer as the admin's next message. Absent: the conversation cannot take a message right now. */
  onAnswer?: (text: string) => void;
}

/**
 * A structured question from the assistant (`request_clarification`): a choice, several choices, or a prompt to answer in
 * the message box (free text, a date, a number, a player). The answer is an ordinary message of the admin's; it is never
 * an approval, and a card is only ever approved on its own card.
 */
export default function ClarificationCard({ clarification, answered, onAnswer }: ClarificationCardProps) {
  const t = useT(adminAssistantMessages);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const { kind, question, options } = clarification;

  const hint = kind === 'date' ? t('clarify.hintDate') : kind === 'number' ? t('clarify.hintNumber') : kind === 'player_pick' ? t('clarify.hintPlayer') : t('clarify.hintText');
  const canPick = !answered && options.length > 0 && (kind === 'choice' || kind === 'multi');

  return (
    <section className={`${PANEL_INSET} space-y-2 p-3`} aria-label={t('clarify.heading')} data-clarification={kind} data-answered={answered}>
      <div className="flex items-center gap-2">
        <h3 className="font-heading text-sm font-semibold">{t('clarify.heading')}</h3>
        {answered && (
          <Badge variant="gray" size="xs">
            {t('clarify.answered')}
          </Badge>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{question}</p>

      {canPick && kind === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button key={option.value} type="button" size="sm" variant="secondary" disabled={onAnswer === undefined} onClick={() => onAnswer?.(option.label)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {canPick && kind === 'multi' && (
        <div className="space-y-1">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(option.value)}
                onChange={(event) => setPicked((current) => (event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value)))}
              />
              {option.label}
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            disabled={onAnswer === undefined || picked.length === 0}
            onClick={() => onAnswer?.(options.filter((option) => picked.includes(option.value)).map((option) => option.label).join(', '))}
          >
            {t('clarify.send')}
          </Button>
        </div>
      )}

      {!answered && !canPick && <p className="text-xs text-poke-text-muted">{hint}</p>}
    </section>
  );
}
