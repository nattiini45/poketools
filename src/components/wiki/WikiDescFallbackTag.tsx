'use client';

import { useT } from '@/i18n/client';
import { pkmnMessages } from '@/i18n/messages/pkmn';

/**
 * The small "EN" tag next to a description that has no German game text (pkmn-l10n §3.6). Render it only
 * when the page is German and `localizeDesc` fell back to the English Showdown text.
 */
export default function WikiDescFallbackTag({ className = '' }: { className?: string }) {
  const t = useT(pkmnMessages);
  return (
    <abbr
      title={t('descFallbackTitle')}
      className={`inline-block rounded-poke-sm border border-poke-border px-1 align-middle text-[10px] font-heading font-semibold uppercase text-poke-text-muted no-underline ${className}`}
    >
      {/* The title is in the UI language; only the tag itself is English. */}
      <span lang="en">{t('descFallbackTag')}</span>
    </abbr>
  );
}
