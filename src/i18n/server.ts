import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  LOCALE_COOKIE,
  PKMN_LANG_COOKIE,
  TZ_COOKIE,
  isLocale,
  isTimeZone,
  resolveDataLocale,
  type Locale,
} from './config';
import { createTranslator, getMessages, type Translator } from './core';
import { createFormatter, type Formatter } from './format';
import type { DeShape, MessageTree, Namespace } from './types';
import type { I18nProviderProps } from './client';

/**
 * Server-side i18n readers (i18n-core §1.2). They read the language cookies
 * only (never the session), wrapped in React `cache()` so one render reads
 * them once. Never call any of these inside an `unstable_cache` /
 * `cachedRead` callback: Next forbids `cookies()` there, and cached values
 * must never hold localized text.
 */

export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
});

export const getDataLocale = cache(async (): Promise<Locale> => {
  const pref = (await cookies()).get(PKMN_LANG_COOKIE)?.value === 'en' ? 'en' : 'follow';
  return resolveDataLocale(await getLocale(), pref);
});

export const getTimeZone = cache(async (): Promise<string> => {
  const v = (await cookies()).get(TZ_COOKIE)?.value;
  return isTimeZone(v) ? v : DEFAULT_TIME_ZONE;
});

export async function getT<E extends MessageTree>(ns: Namespace<E>, locale?: Locale): Promise<Translator<E>> {
  return createTranslator(ns, locale ?? (await getLocale()));
}

export async function getMessagesFor<E extends MessageTree>(ns: Namespace<E>, locale?: Locale): Promise<DeShape<E>> {
  return getMessages(ns, locale ?? (await getLocale()));
}

/** Calendar dates and numbers on the server; instants go through `<LocalTime>` (rule T2). */
export async function getFormatter(opts?: { locale?: Locale; timeZone?: string }): Promise<Formatter> {
  const locale = opts?.locale ?? (await getLocale());
  const timeZone = opts?.timeZone ?? (await getTimeZone());
  return createFormatter({ locale, timeZone });
}

/** Root layout and nested overrides: everything `I18nProvider` needs. */
export async function getI18nProviderProps(): Promise<Omit<I18nProviderProps, 'children'>> {
  const [locale, dataLocale, timeZone] = await Promise.all([getLocale(), getDataLocale(), getTimeZone()]);
  return { locale, dataLocale, timeZone, requestTime: Date.now() };
}

function readCookieHeader(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** Route handlers: the UI locale from the Cookie header (no `next/headers`). */
export function getRequestLocale(req: Request): Locale {
  const v = readCookieHeader(req, LOCALE_COOKIE);
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Route handlers: the Pokémon-data locale from the Cookie header. */
export function getRequestDataLocale(req: Request): Locale {
  const pref = readCookieHeader(req, PKMN_LANG_COOKIE) === 'en' ? 'en' : 'follow';
  return resolveDataLocale(getRequestLocale(req), pref);
}
