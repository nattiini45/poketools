'use client';

import { useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { pkmnMessages } from '@/i18n/messages/pkmn';

/**
 * The "EN" tag next to a description that has no German game text (pkmn-l10n §3.6):
 * shown only in a German UI when the API reports `descLang === 'en'`.
 */
export default function DescFallbackTag({ descLang }: { descLang: Locale | undefined }) {
  const locale = useLocale();
  const t = useT(pkmnMessages);
  if (locale !== 'de' || descLang !== 'en') return null;
  return (
    <span
      className="ml-1 shrink-0 text-[8px] font-semibold text-poke-text-muted border border-poke-border rounded px-0.5 align-middle"
      title={t('descFallbackTitle')}
    >
      {t('descFallbackTag')}
    </span>
  );
}
