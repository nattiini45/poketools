'use client';

import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useLocale, useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { applyLanguagePreference } from '@/i18n/switch-language';

/** The site-wide switches the admin shell offers in its command menu and its account menu: theme and language. */
export function useShellActions() {
  const t = useT(shellMessages);
  const router = useRouter();
  const locale = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return {
    dark,
    themeLabel: dark ? t('admin.command.themeLight') : t('admin.command.themeDark'),
    toggleTheme: () => setTheme(dark ? 'light' : 'dark'),
    languageLabel: t('admin.command.language'),
    // A refused switch is logged by applyLanguagePreference and leaves the language as it is.
    switchLanguage: () => void applyLanguagePreference({ locale: locale === 'de' ? 'en' : 'de' }, router),
  };
}
