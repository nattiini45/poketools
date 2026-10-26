/**
 * Diagnostic rendering (client-safe): code + params -> a sentence, after the cache read.
 *
 * Compile results hold codes and params only. This module resolves stage, view and rule keys to display names
 * when it is given the definition (an advancement rule reads as the two stages it connects), maps metric and
 * reason codes to their catalog labels, and lets the translator format the numbers. A code the catalog does not
 * know falls back through `translator.dynamic` (English, then the key).
 */
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioMessages } from '@/i18n/messages/format-studio';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { resolveLText } from '@/lib/studio-core/ltext';
import type { FormatDefinition, LText } from '../types';
import type { Diagnostic, DiagnosticCode, Fix, Severity } from './diagnostics';

type Params = Record<string, string | number>;

const STAGE_PARAMS: ReadonlySet<string> = new Set(['stage', 'from_stage', 'to_stage']);

/**
 * The param that decides singular or plural for a code or fix id. The catalog's `{one, other}` forms read a
 * param called `count`, so the renderer copies that value there; sentences that already have a `count` param are
 * not listed.
 */
const DIAGNOSTIC_COUNT_PARAM: Partial<Record<DiagnosticCode, string>> = {
  groups_too_many: 'participants',
  advance_exceeds_source: 'requested',
  advance_bracket_byes: 'byes',
  advance_overlap: 'requested',
  series_override_unreachable: 'rounds',
};
const FIX_COUNT_PARAM: Partial<Record<Fix['id'], string>> = { add_wildcard: 'n' };

function withCount(params: Params, raw: Readonly<Record<string, string | number | boolean>>, name: string | undefined): Params {
  const value = name === undefined ? undefined : raw[name];
  return typeof value === 'number' ? { ...params, count: value } : params;
}

function nameOf(text: LText | undefined, locale: Locale, fallback: string): string {
  if (text === undefined) return fallback;
  return resolveLText(text, { viewer: locale })?.value ?? fallback;
}

function toParams(raw: Readonly<Record<string, string | number | boolean>>): Params {
  const out: Params = {};
  for (const [name, value] of Object.entries(raw)) out[name] = typeof value === 'boolean' ? String(value) : value;
  return out;
}

/** An advancement rule has no name of its own, so it reads as the stages it connects; its key is the fallback. */
function edgeName(def: FormatDefinition, key: string, locale: Locale): string {
  const edge = def.edges.find((e) => e.key === key);
  if (edge === undefined) return key;
  const stageName = (stageKey: string) => nameOf(def.stages.find((s) => s.key === stageKey)?.name, locale, stageKey);
  return `${stageName(edge.from)} → ${stageName(edge.to)}`;
}

/** The params a message sees: names for keys (with a definition), labels for metric and reason codes. */
function displayParams(
  raw: Readonly<Record<string, string | number | boolean>>,
  locale: Locale,
  pointer: string | null,
  def: FormatDefinition | undefined,
): Params {
  // Metric labels come from the primitives catalog, so a metric reads the same here and in a description.
  const metrics = createTranslator(formatStudioPrimitivesMessages, locale);
  const reasons = createTranslator(formatStudioMessages, locale);
  const out = toParams(raw);
  for (const [name, value] of Object.entries(out)) {
    if (typeof value !== 'string') continue;
    if (def !== undefined) {
      if (STAGE_PARAMS.has(name)) {
        out[name] = nameOf(def.stages.find((s) => s.key === value)?.name, locale, value);
      } else if (name === 'rule') {
        out[name] = nameOf(def.rules.find((r) => r.id === value)?.text, locale, value);
      } else if (name === 'view') {
        out[name] = nameOf(def.views.find((v) => v.key === value)?.label, locale, value);
      } else if (name === 'edge') {
        out[name] = edgeName(def, value, locale);
      }
    }
    if (name === 'metric' && metrics.has(`metric.${value}`)) out[name] = metrics.dynamic(`metric.${value}`);
    if (name === 'reason' && reasons.has(`reasons.${value}`)) out[name] = reasons.dynamic(`reasons.${value}`);
  }
  if (pointer !== null) out.pointer = pointer === '' ? '/' : pointer;
  return out;
}

export function renderDiagnostic(d: Diagnostic, locale: Locale, def?: FormatDefinition): string {
  const t = createTranslator(formatStudioMessages, locale);
  const params = withCount(displayParams(d.params, locale, d.json_pointer, def), d.params, DIAGNOSTIC_COUNT_PARAM[d.code]);
  return t.dynamic(`diagnostics.${d.code}`, params);
}

export function renderFix(fix: Fix, locale: Locale): string {
  const t = createTranslator(formatStudioMessages, locale);
  return t.dynamic(`fixes.${fix.id}`, withCount(displayParams(fix.params, locale, null, undefined), fix.params, FIX_COUNT_PARAM[fix.id]));
}

export function renderSeverity(severity: Severity, locale: Locale): string {
  return createTranslator(formatStudioMessages, locale).dynamic(`severity.${severity}`);
}
