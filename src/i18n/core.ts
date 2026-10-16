/**
 * Pure translation runtime (i18n-core §1.3). Client- and server-safe: no
 * hooks, no `server-only`, no cookies. Viewerless text (Discord, social
 * posts, painters) uses `createTranslator(ns, locale)` directly.
 */
import type { ReactNode } from 'react';
import { INTL_TAG, type Locale } from './config';
import { formatParamNumber, pluralRulesFor } from './intl-cache';
import { renderRich, type RichValues } from './rich';
import type {
  ArgsFor,
  At,
  DeShape,
  Leaves,
  MessageLeaf,
  MessageTree,
  Namespace,
  ParamValue,
  PluralForms,
  RichArgsFor,
} from './types';

export interface Translator<E> {
  <K extends Leaves<E>>(key: K, ...args: ArgsFor<At<E, K>>): string;
  rich<K extends Leaves<E>>(key: K, values: RichArgsFor<At<E, K>>): ReactNode;
  /** Dynamic keys only (enum values, codes). */
  has(key: string): boolean;
  /** Dynamic lookup: locale -> English -> `fallback` -> the key itself. */
  dynamic(key: string, params?: Record<string, ParamValue>, fallback?: string): string;
  readonly locale: Locale;
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const warned = new Set<string>();

function warnOnce(id: string, ...parts: unknown[]): void {
  if (!IS_DEV || warned.has(id)) return;
  warned.add(id);
  console.warn(...parts);
}

export function isPluralForms(v: unknown): v is PluralForms {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).one === 'string' &&
    typeof (v as Record<string, unknown>).other === 'string'
  );
}

function isLeaf(v: unknown): v is MessageLeaf {
  return typeof v === 'string' || isPluralForms(v);
}

/** Walks a dotted path through a message tree; `undefined` when absent. */
export function lookupPath(tree: unknown, key: string): unknown {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** `zero` when `count === 0` and the form exists, else `Intl.PluralRules`. */
export function selectPlural(forms: PluralForms, count: number, locale: Locale): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return pluralRulesFor(locale).select(count) === 'one' ? forms.one : forms.other;
}

/** Replaces `{name}` with the param; numbers are formatted per locale. A missing param stays visible. */
export function interpolate(
  template: string,
  params: Readonly<Record<string, ParamValue>> | undefined,
  locale: Locale,
): string {
  if (!template.includes('{')) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
    if (value === undefined || value === null) {
      warnOnce(`param:${template}:${name}`, '[i18n] missing param', name, 'in', JSON.stringify(template));
      return whole;
    }
    return typeof value === 'number' ? formatParamNumber(value, locale) : String(value);
  });
}

/** Canvas/3D caps: `'Großes Finale'` -> `'GROSSES FINALE'` (never `ẞ`). */
export function upperForPaint(text: string, locale: Locale): string {
  return text.toLocaleUpperCase(INTL_TAG[locale]);
}

/** The structured messages of one language (label objects, lists). */
export function getMessages<E extends MessageTree>(ns: Namespace<E>, locale: Locale): DeShape<E> {
  return locale === 'en' ? (ns.en as unknown as DeShape<E>) : ns.de;
}

function countOf(params: Readonly<Record<string, unknown>> | undefined): number {
  const count = params?.count;
  return typeof count === 'number' ? count : 0;
}

const translators = new WeakMap<object, Map<Locale, Translator<MessageTree>>>();

function buildTranslator<E extends MessageTree>(ns: Namespace<E>, locale: Locale): Translator<E> {
  const primary: unknown = getMessages(ns, locale);

  const resolve = (key: string): MessageLeaf | undefined => {
    const own = lookupPath(primary, key);
    if (isLeaf(own)) return own;
    const english = locale === 'en' ? undefined : lookupPath(ns.en, key);
    warnOnce(`missing:${ns.id}:${locale}:${key}`, '[i18n] missing', ns.id, key);
    return isLeaf(english) ? english : undefined;
  };

  const render = (leaf: MessageLeaf, params: Readonly<Record<string, ParamValue>> | undefined): string => {
    const template = typeof leaf === 'string' ? leaf : selectPlural(leaf, countOf(params), locale);
    return interpolate(template, params, locale);
  };

  const translate = (key: string, params?: Readonly<Record<string, ParamValue>>): string => {
    const leaf = resolve(key);
    return leaf === undefined ? key : render(leaf, params);
  };

  const call = (key: string, params?: Record<string, ParamValue>): string => translate(key, params);
  const translator = Object.assign(call, {
    rich: (key: string, values: RichValues): ReactNode => {
      const leaf = resolve(key);
      if (leaf === undefined) return key;
      const template = typeof leaf === 'string' ? leaf : selectPlural(leaf, countOf(values), locale);
      return renderRich(template, values, locale);
    },
    has: (key: string): boolean => isLeaf(lookupPath(primary, key)) || isLeaf(lookupPath(ns.en, key)),
    dynamic: (key: string, params?: Record<string, ParamValue>, fallback?: string): string => {
      const own = lookupPath(primary, key);
      if (isLeaf(own)) return render(own, params);
      const english = lookupPath(ns.en, key);
      if (isLeaf(english)) {
        warnOnce(`missing:${ns.id}:${locale}:${key}`, '[i18n] missing', ns.id, key);
        return render(english, params);
      }
      warnOnce(`missing:${ns.id}:${locale}:${key}`, '[i18n] missing', ns.id, key);
      return fallback ?? key;
    },
    locale,
  });
  // The runtime signature is the untyped one; the key/param typing lives in Translator<E>.
  return translator as unknown as Translator<E>;
}

/** Memoized per `(namespace, locale)`. */
export function createTranslator<E extends MessageTree>(ns: Namespace<E>, locale: Locale): Translator<E> {
  let perLocale = translators.get(ns);
  if (!perLocale) {
    perLocale = new Map();
    translators.set(ns, perLocale);
  }
  const existing = perLocale.get(locale);
  if (existing) return existing as unknown as Translator<E>;
  const created = buildTranslator(ns, locale);
  perLocale.set(locale, created as unknown as Translator<MessageTree>);
  return created;
}
