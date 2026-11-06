'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';

/** The challenge string for a Showdown custom game, with an explicit copy action. */
export default function ShowdownChallenge({ value }: { value: string }) {
  const t = useT(rulesetStudioSectionsMessages);
  const [copied, setCopied] = useState(false);
  return (
    <section className="space-y-2" aria-labelledby="showdown-challenge-heading">
      <h3 id="showdown-challenge-heading" className="font-heading text-sm font-semibold text-poke-text-secondary">{t('challenge.heading')}</h3>
      <p className="text-xs text-poke-text-muted">{t('challenge.help')}</p>
      <textarea
        aria-label={t('challenge.label')}
        readOnly
        rows={5}
        className="w-full resize-y rounded-poke-md border border-poke-border bg-poke-surface p-3 font-mono text-xs text-poke-text-primary"
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {t('challenge.copy')}
        </Button>
        <span role="status" className="text-xs text-poke-text-muted">{copied ? t('challenge.copied') : ''}</span>
      </div>
    </section>
  );
}
