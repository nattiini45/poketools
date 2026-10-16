'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  DEFAULT_TIME_ZONE,
  FALLBACK_REQUEST_TIME,
  LANGUAGE_COOKIE_MAX_AGE,
  TZ_COOKIE,
  isTimeZone,
  type Locale,
} from './config';
import { createTranslator, getMessages, type Translator } from './core';
import { createFormatter, type Formatter } from './format';
import type { DeShape, MessageTree, Namespace } from './types';

/**
 * Client i18n provider and hooks (i18n-core §1.7).
 *
 * The provider carries only `locale`, `dataLocale`, `timeZone` and
 * `requestTime`; messages come from statically imported namespace modules
 * (`useT(fooMessages)`). Hooks never throw: without a provider they render
 * English (D13), and `useT` / `useMessages` warn once outside production.
 * Never store translated text in state; store keys and translate in render.
 */

export interface I18nProviderProps {
  locale: Locale;
  dataLocale: Locale;
  timeZone: string;
  requestTime: number;
  /**
   * Pin `timeZone`: `useTimeZone` returns it on the client too, never the
   * browser zone. Set by nested providers for viewerless output (overlays,
   * the stored social image), which always render in the league zone.
   */
  pinTimeZone?: boolean;
  children: ReactNode;
}

interface I18nContextValue {
  readonly locale: Locale;
  readonly dataLocale: Locale;
  readonly timeZone: string;
  readonly requestTime: number;
  readonly pinTimeZone: boolean;
  readonly missing: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  dataLocale: 'en',
  timeZone: DEFAULT_TIME_ZONE,
  requestTime: FALLBACK_REQUEST_TIME,
  pinTimeZone: false,
  missing: true,
});

let providerWarningShown = false;

/** One warning per module instance when a translating hook runs without a provider. */
function warnMissingProvider(missing: boolean): void {
  if (!missing || providerWarningShown || process.env.NODE_ENV === 'production') return;
  providerWarningShown = true;
  console.warn('[i18n] I18nProvider missing; rendering English');
}

const noopSubscribe = () => () => {};
let browserZone: string | undefined;

function getBrowserZone(): string {
  if (browserZone === undefined) {
    try {
      browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
    } catch {
      browserZone = DEFAULT_TIME_ZONE;
    }
  }
  return browserZone;
}

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Rule T3: after mount, record the browser zone in `plc_tz` when it differs. Never refreshes. */
function TimeZoneSync() {
  useEffect(() => {
    const zone = getBrowserZone();
    if (!isTimeZone(zone)) return;
    let stored: string | undefined;
    try {
      stored = readCookie(TZ_COOKIE);
      stored = stored === undefined ? undefined : decodeURIComponent(stored);
    } catch {
      stored = undefined;
    }
    if (stored === zone) return;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }, []);
  return null;
}

export function I18nProvider({
  locale,
  dataLocale,
  timeZone,
  requestTime,
  pinTimeZone = false,
  children,
}: I18nProviderProps) {
  const parent = useContext(I18nContext);
  const value = useMemo<I18nContextValue>(
    () => ({ locale, dataLocale, timeZone, requestTime, pinTimeZone, missing: false }),
    [locale, dataLocale, timeZone, requestTime, pinTimeZone],
  );
  return (
    <I18nContext.Provider value={value}>
      {parent.missing ? <TimeZoneSync /> : null}
      {children}
    </I18nContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** The Pokémon-name locale: the UI locale, or `'en'` with "Keep Pokémon terms in English". */
export function useDataLocale(): Locale {
  return useContext(I18nContext).dataLocale;
}

export function useT<E extends MessageTree>(ns: Namespace<E>): Translator<E> {
  const { locale, missing } = useContext(I18nContext);
  warnMissingProvider(missing);
  return useMemo(() => createTranslator(ns, locale), [ns, locale]);
}

export function useMessages<E extends MessageTree>(ns: Namespace<E>): DeShape<E> {
  const { locale, missing } = useContext(I18nContext);
  warnMissingProvider(missing);
  return getMessages(ns, locale);
}

/**
 * Rule T1: server render and hydration use the provider zone (cookie, else
 * Europe/Berlin); React then re-renders once with the browser zone if it
 * differs. No hydration mismatch. A pinned provider (`pinTimeZone`: overlays,
 * the stored social image) keeps its zone on the client as well.
 */
export function useTimeZone(): string {
  const { timeZone: providerZone, pinTimeZone } = useContext(I18nContext);
  const getProviderZone = () => providerZone;
  return useSyncExternalStore(noopSubscribe, pinTimeZone ? getProviderZone : getBrowserZone, getProviderZone);
}

export function useFormatter(): Formatter {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useMemo(() => createFormatter({ locale, timeZone }), [locale, timeZone]);
}

/** The server's request time: the stable "now" for the first render (rule T4). */
export function useRequestTime(): number {
  return useContext(I18nContext).requestTime;
}
