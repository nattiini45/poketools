/**
 * Client-side rendering of API errors (i18n-core §4.2). Pure: no hooks, no
 * `server-only`; `use-api-error.ts` wraps it for components.
 *
 * Servers send an English `error`, a `code` and, for templated messages,
 * `params`. The text is resolved in this order:
 *  1. English UI: the server's own English `error` (the catalog `en` text is
 *     the same message, so English never changes; multi-message codes keep
 *     their specific text).
 *  2. `code` found in `errorsCommon` or one of `ctx.catalogs`, with every
 *     placeholder of the message supplied: the translated message. Params
 *     named in `PKMN_PARAM_KINDS` go through `ctx.pkmn` when given, and so
 *     does each element of a `PKMN_LIST_PARAM_KINDS` list; params listed in
 *     `ENUM_PARAMS_BY_CODE` for the code render as their enum label.
 *  3. The English `error`.
 *  4. `errorsCommon.unknown_error`.
 */
import type { Locale } from './config';
import { enumLabel, type EnumGroup } from './content/enum-label';
import { createTranslator, isPluralForms, lookupPath } from './core';
import { enumMessages } from './messages/enums';
import { errorsCommon, type ErrorCatalog } from './messages/errors';
import { PKMN_LIST_PARAM_KINDS, PKMN_PARAM_KINDS, type PkmnParamLocalizer } from './pkmn-seam';
import type { ParamValue } from './types';

export interface ApiErrorLike {
  error?: string | null;
  code?: string | null;
  params?: Record<string, string | number> | null;
}

export interface ApiErrorTextContext {
  locale: Locale;
  catalogs: readonly ErrorCatalog[];
  pkmn?: PkmnParamLocalizer;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanParams(v: unknown): Record<string, string | number> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return out;
}

/**
 * Normalizes anything a `catch` or a failed response yields: a fetch
 * `TypeError` (the request never reached the server) becomes
 * `{ code: 'network_error' }`, an API body keeps its `error` / `code` /
 * `params`, any other `Error` keeps its message.
 */
export function toApiErrorLike(e: unknown): ApiErrorLike {
  if (e instanceof TypeError) return { code: 'network_error' };
  if (typeof e === 'string') return { error: e };
  if (isRecord(e) && ('error' in e || 'code' in e)) {
    const out: ApiErrorLike = {};
    if (typeof e.error === 'string') out.error = e.error;
    if (typeof e.code === 'string') out.code = e.code;
    const params = cleanParams(e.params);
    if (params) out.params = params;
    if (out.error !== undefined || out.code !== undefined) return out;
  }
  if (e instanceof Error) return { error: e.message };
  return {};
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

function placeholdersOf(leaf: unknown): string[] {
  const templates = typeof leaf === 'string' ? [leaf] : isPluralForms(leaf) ? [leaf.one, leaf.other] : [];
  const names = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1]);
  }
  if (isPluralForms(leaf)) names.add('count');
  return [...names];
}

/**
 * Params that carry a raw DB enum value, per code (param names like `from` /
 * `to` are too generic to map globally). Rendered through `enums.<group>.*`.
 */
const ENUM_PARAMS_BY_CODE: Readonly<Record<string, Readonly<Record<string, EnumGroup>>>> = {
  match_transition_invalid: { from: 'matchStatus', to: 'matchStatus' },
  match_state_changed: { status: 'matchStatus' },
  ai_match_status_invalid: { status: 'matchStatus' },
  ai_analysis_completed_only: { status: 'matchStatus' },
  ai_scouting_scheduled_only: { status: 'matchStatus' },
};

function hasOwn<T extends object>(obj: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function localizeParams(
  code: string,
  params: Readonly<Record<string, string | number>>,
  ctx: ApiErrorTextContext,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...params };
  const enumParams = hasOwn(ENUM_PARAMS_BY_CODE, code) ? ENUM_PARAMS_BY_CODE[code] : undefined;
  const { pkmn } = ctx;
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue;
    if (enumParams && hasOwn(enumParams, name)) {
      out[name] = enumLabel(createTranslator(enumMessages, ctx.locale), enumParams[name], value);
    } else if (pkmn && hasOwn(PKMN_PARAM_KINDS, name)) {
      out[name] = pkmn(PKMN_PARAM_KINDS[name], value);
    } else if (pkmn && hasOwn(PKMN_LIST_PARAM_KINDS, name)) {
      const { kind, separator } = PKMN_LIST_PARAM_KINDS[name];
      out[name] = value
        .split(separator)
        .map((element) => pkmn(kind, element))
        .join(separator);
    }
  }
  return out;
}

/** The catalog that holds `code`, `errorsCommon` first. */
function catalogFor(code: string, catalogs: readonly ErrorCatalog[]): ErrorCatalog | undefined {
  const common: ErrorCatalog = errorsCommon;
  for (const ns of [common, ...catalogs]) {
    const leaf = lookupPath(ns.en, code);
    if (typeof leaf === 'string' || isPluralForms(leaf)) return ns;
  }
  return undefined;
}

/** Translates `code` with `params`, or `undefined` when unknown or a placeholder is missing. */
function translateCode(
  code: string,
  params: Readonly<Record<string, string | number>> | undefined,
  ctx: ApiErrorTextContext,
): string | undefined {
  if (code.includes('.')) return undefined; // codes are flat keys, never paths
  const ns = catalogFor(code, ctx.catalogs);
  if (!ns) return undefined;
  const given = params ?? {};
  const required = new Set([...placeholdersOf(lookupPath(ns.en, code)), ...placeholdersOf(lookupPath(ns.de, code))]);
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(given, name)) return undefined;
  }
  return createTranslator(ns, ctx.locale).dynamic(code, localizeParams(code, given, ctx));
}

/** The text to show for a failed API call (resolution order in the file header). */
export function apiErrorText(res: ApiErrorLike | null | undefined, ctx: ApiErrorTextContext): string {
  const english = typeof res?.error === 'string' && res.error.trim() !== '' ? res.error : undefined;
  // Decision D2 (decided): in English the server's English `error` text wins over the catalog;
  // in German clients render from the `code` (steps 2-4 below).
  if (ctx.locale === 'en' && english !== undefined) return english;
  if (res?.code) {
    const translated = translateCode(res.code, res.params ?? undefined, ctx);
    if (translated !== undefined) return translated;
  }
  if (english !== undefined) return english;
  return createTranslator(errorsCommon, ctx.locale)('unknown_error');
}
