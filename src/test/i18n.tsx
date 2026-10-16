/**
 * i18n test helpers (i18n-core §8.1). Tests run in `node` with
 * `renderToStaticMarkup`; there is no @testing-library.
 *
 * Defaults: locale 'en', dataLocale = locale, timeZone 'UTC',
 * requestTime Date.UTC(2026, 9, 9, 12).
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FALLBACK_REQUEST_TIME, type Locale } from '@/i18n/config';
import { I18nProvider } from '@/i18n/client';

export interface I18nTestOptions {
  locale?: Locale;
  dataLocale?: Locale;
  timeZone?: string;
  requestTime?: number;
}

export function withI18n(ui: ReactElement, o: I18nTestOptions = {}): ReactElement {
  const locale = o.locale ?? 'en';
  return (
    <I18nProvider
      locale={locale}
      dataLocale={o.dataLocale ?? locale}
      timeZone={o.timeZone ?? 'UTC'}
      requestTime={o.requestTime ?? FALLBACK_REQUEST_TIME}
    >
      {ui}
    </I18nProvider>
  );
}

export function renderWithI18n(ui: ReactElement, o?: I18nTestOptions): string {
  return renderToStaticMarkup(withI18n(ui, o));
}
