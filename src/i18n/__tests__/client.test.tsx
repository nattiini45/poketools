import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  I18nProvider,
  useDataLocale,
  useFormatter,
  useLocale,
  useMessages,
  useRequestTime,
  useT,
  useTimeZone,
} from '../client';
import { LocalTime, RelativeTime } from '../LocalTime';
import { defineDe, defineNamespace } from '../define';
import { FALLBACK_REQUEST_TIME } from '../config';
import { renderWithI18n } from '@/test/i18n';

const en = { greeting: 'Hello {name}', title: 'Draft paused' } as const;
const de = defineDe<typeof en>()({ greeting: 'Hallo {name}', title: 'Draft pausiert' });
const ns = defineNamespace('test/client', en, de);

function Probe() {
  const t = useT(ns);
  const messages = useMessages(ns);
  const formatter = useFormatter();
  return (
    <p>
      {useLocale()}|{useDataLocale()}|{useTimeZone()}|{useRequestTime()}|{t('greeting', { name: 'Ash' })}|
      {messages.title}|{formatter.locale}
    </p>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hooks without a provider (D13)', () => {
  it('never throw, render English, and warn exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = renderToStaticMarkup(<Probe />);
    const second = renderToStaticMarkup(<Probe />);
    expect(first).toBe(
      `<p>en|en|Europe/Berlin|${FALLBACK_REQUEST_TIME}|Hello Ash|Draft paused|en</p>`,
    );
    expect(second).toBe(first);
    const providerWarnings = warn.mock.calls.filter((call) => call[0] === '[i18n] I18nProvider missing; rendering English');
    expect(providerWarnings).toHaveLength(1);
  });
});

describe('I18nProvider', () => {
  it('provides locale, data locale, zone and request time', () => {
    const html = renderWithI18n(<Probe />, { locale: 'de', dataLocale: 'en', timeZone: 'UTC', requestTime: 42 });
    expect(html).toBe('<p>de|en|UTC|42|Hallo Ash|Draft pausiert|de</p>');
  });

  it('lets a nested provider override the outer one', () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en" dataLocale="en" timeZone="UTC" requestTime={1}>
        <Probe />
        <I18nProvider locale="de" dataLocale="de" timeZone="Europe/Berlin" requestTime={2}>
          <Probe />
        </I18nProvider>
      </I18nProvider>,
    );
    expect(html).toContain('<p>en|en|UTC|1|Hello Ash');
    expect(html).toContain('<p>de|de|Europe/Berlin|2|Hallo Ash');
  });
});

describe('LocalTime', () => {
  const AT = '2026-10-09T16:30:00Z';

  it('renders the provider zone on the server snapshot', () => {
    expect(renderWithI18n(<LocalTime value={AT} preset="time" />, { timeZone: 'UTC' })).toBe(
      '<time dateTime="2026-10-09T16:30:00.000Z">16:30</time>',
    );
    expect(renderWithI18n(<LocalTime value={AT} preset="time" />, { timeZone: 'Europe/Berlin' })).toContain('18:30');
  });

  it('zone="both" appends league time only when the zones differ', () => {
    const differ = renderWithI18n(<LocalTime value={AT} preset="time" zone="both" />, { timeZone: 'UTC' });
    expect(differ).toContain('16:30 · 18:30');
    expect(differ).toMatch(/league time/);
    const differDe = renderWithI18n(<LocalTime value={AT} preset="time" zone="both" />, {
      timeZone: 'UTC',
      locale: 'de',
    });
    expect(differDe).toMatch(/Ligazeit/);
    const same = renderWithI18n(<LocalTime value={AT} preset="time" zone="both" />, { timeZone: 'Europe/Berlin' });
    expect(same).toBe('<time dateTime="2026-10-09T16:30:00.000Z">18:30</time>');
  });
});

describe('RelativeTime', () => {
  it('first render uses the provider request time', () => {
    const requestTime = Date.parse('2026-10-09T12:00:00Z');
    const html = renderWithI18n(<RelativeTime value="2026-10-09T11:55:00Z" />, { requestTime });
    expect(html).toContain('5 minutes ago');
    const htmlDe = renderWithI18n(<RelativeTime value="2026-10-09T11:59:40Z" />, { requestTime, locale: 'de' });
    expect(htmlDe).toContain('gerade eben');
  });
});
