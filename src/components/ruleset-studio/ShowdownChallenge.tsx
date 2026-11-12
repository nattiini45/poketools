'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';

/** How long "Copied." stays before the status line clears again. */
const STATUS_MS = 3000;

interface ShowdownChallengeProps {
  value: string;
  /** The heading level of the section heading; one below the page's own sections. Default 3. */
  headingLevel?: 2 | 3;
}

/** The challenge string for a Showdown custom game, with an explicit copy action and what the string cannot carry. */
export default function ShowdownChallenge({ value, headingLevel = 3 }: ShowdownChallengeProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const headingId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const show = (next: 'copied' | 'failed') => {
    setStatus(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), STATUS_MS);
  };
  const copy = async () => {
    try {
      // `navigator.clipboard` is missing outside a secure context and the write is refused without permission: both land here.
      await navigator.clipboard.writeText(value);
      show('copied');
    } catch (error) {
      console.warn('[ruleset-studio] could not copy the Showdown challenge:', error);
      area.current?.select();
      show('failed');
    }
  };

  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <Heading id={headingId} className="font-heading text-sm font-semibold text-fg-muted">{t('challenge.heading')}</Heading>
      <p className="text-xs text-fg-muted">{t('challenge.help')}</p>
      <p className="text-xs text-fg-muted">{t('challenge.limits')}</p>
      <textarea
        ref={area}
        aria-label={t('challenge.label')}
        readOnly
        rows={5}
        className="w-full resize-y rounded-poke-md border border-hairline bg-surface p-3 font-mono text-xs text-fg"
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {t('challenge.copy')}
        </Button>
        <span role="status" className="text-xs text-fg-muted">
          {status === 'copied' ? t('challenge.copied') : status === 'failed' ? t('challenge.copyFailed') : ''}
        </span>
      </div>
    </section>
  );
}
