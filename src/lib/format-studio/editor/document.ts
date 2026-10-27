/**
 * The document the editor works on: a plain `FormatDefinition`-shaped object whose values may be invalid (the
 * Issues tab exists for that). Pure and client-safe; the kit is imported through its client entry only.
 *
 * `normalizeDraft` makes a stored draft showable: it fills the schema's defaults for missing optional members,
 * keeps every member it does not know untouched (the Issues tab offers to remove them) and refuses only shapes a
 * form cannot show (a list that is not a list, an item that is not an object, a text that is not an object). The
 * baseline of "unsaved changes" is the canonical JSON of the normalised document, so opening a draft never starts
 * dirty. Nothing here mutates its input.
 */
import { JsonError, KEY_PATTERN, canonicalizeJson, type FormatDefinition, type Stage } from '@/lib/format-kit/client';
import { LTEXT_MAX_CHARS, ltext, type LText, type LTextValue } from '@/lib/studio-core/ltext';
import type { Locale } from '@/i18n/config';

/** Same shape as `FormatDefinition`; values may be invalid. */
export type DraftDocument = FormatDefinition;

export type NormalizeResult =
  | { ok: true; doc: DraftDocument; preservedKeys: string[] }
  | { ok: false; reason: 'not_object' | 'shape' };

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecArray(value: unknown): value is Rec[] {
  return Array.isArray(value) && value.every(isRec);
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Top-level members of the schema; every other member is kept as it is. */
const KNOWN_TOP_LEVEL: ReadonlySet<string> = new Set([
  'schema_version',
  'identity',
  'stages',
  'edges',
  'views',
  'rules',
  'text',
  'theme',
  'modules',
]);

/** The value of an optional list member: absent gives `[]`, a list is kept, anything else is a bad shape. */
function listOf(value: unknown, itemsAreObjects = true): Rec[] | unknown[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (itemsAreObjects && !isRecArray(value)) return null;
  return value;
}

/** A copy of `source` with `fallbacks` added for every member it does not have. */
function withDefaults(source: Rec, fallbacks: Rec): Rec {
  const out: Rec = { ...source };
  for (const key of Object.keys(fallbacks)) {
    if (!hasOwn(out, key)) out[key] = fallbacks[key];
  }
  return out;
}

const PAIRING_DEFAULTS: Readonly<Record<string, Rec>> = {
  round_robin: { legs: 1, mirror_legs: true },
  swiss: { avoid_repeats: true },
  single_elim: { third_place: false },
  double_elim: { bracket_reset: false },
};

function normalizePairing(pairing: Rec): Rec {
  const kind = pairing.kind;
  const defaults = typeof kind === 'string' && hasOwn(PAIRING_DEFAULTS, kind) ? PAIRING_DEFAULTS[kind] : {};
  return withDefaults(pairing, defaults);
}

function normalizeStage(stage: Rec): Rec | null {
  const { name, participants, pairing, series, scoring } = stage;
  if (!isRec(name) || !isRec(participants) || !isRec(pairing) || !isRec(series) || !isRec(scoring)) return null;
  if (stage.groups !== undefined && !isRec(stage.groups)) return null;
  if (stage.ruleset !== undefined && !isRec(stage.ruleset)) return null;
  const rank = listOf(stage.rank);
  const columns = listOf(stage.columns, false);
  const overrides = listOf(series.overrides);
  if (rank === null || columns === null || overrides === null) return null;

  const out = withDefaults(stage, {
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
  });
  out.pairing = normalizePairing(pairing);
  out.series = withDefaults(series, { allow_draw: false });
  (out.series as Rec).overrides = (overrides as Rec[]).map((o) => withDefaults(o, { from: 'start' }));
  out.scoring = withDefaults(scoring, { loss: 0, bye: 0 });
  out.rank = rank;
  out.columns = columns;
  if (isRec(stage.groups)) out.groups = withDefaults(stage.groups, { method: 'serpentine' });
  return out;
}

function normalizeEdge(edge: Rec): Rec | null {
  if (!isRecArray(edge.select)) return null;
  return withDefaults(edge, { seeding: 'rank', gate: 'admin_confirm' });
}

function normalizeRule(rule: Rec): Rec | null {
  if (!isRec(rule.text)) return null;
  if (rule.scope !== undefined && !isRec(rule.scope)) return null;
  return withDefaults(rule, { scope: { kind: 'season' }, verify: 'admin_checklist', when: 'once', visible_to_players: true });
}

function mapAll<T>(items: readonly Rec[], fn: (item: Rec) => T | null): T[] | null {
  const out: T[] = [];
  for (const item of items) {
    const mapped = fn(item);
    if (mapped === null) return null;
    out.push(mapped);
  }
  return out;
}

/**
 * Fills defaults and checks that a form can show the draft. Idempotent: normalising a normalised document gives
 * an equal document. `preservedKeys` lists the top-level members outside the schema (kept untouched).
 */
export function normalizeDraft(raw: unknown): NormalizeResult {
  if (!isRec(raw)) return { ok: false, reason: 'not_object' };
  const shape = { ok: false, reason: 'shape' } as const;

  const identity = raw.identity;
  if (!isRec(identity) || !isRec(identity.name)) return shape;
  if (identity.summary !== undefined && !isRec(identity.summary)) return shape;

  const stagesRaw = listOf(raw.stages);
  const edgesRaw = listOf(raw.edges);
  const viewsRaw = listOf(raw.views);
  const rulesRaw = listOf(raw.rules);
  const modulesRaw = listOf(raw.modules);
  if (stagesRaw === null || edgesRaw === null || viewsRaw === null || rulesRaw === null || modulesRaw === null) return shape;
  if (!(viewsRaw as Rec[]).every((v) => Array.isArray(v.stages))) return shape;

  if (raw.text !== undefined && !isRec(raw.text)) return shape;
  const sectionsRaw = listOf(isRec(raw.text) ? raw.text.sections : undefined);
  if (sectionsRaw === null) return shape;
  if (!(sectionsRaw as Rec[]).every((s) => isRec(s.title) && isRec(s.body))) return shape;
  if (raw.theme !== undefined && !isRec(raw.theme)) return shape;

  const stages = mapAll(stagesRaw as Rec[], normalizeStage);
  const edges = mapAll(edgesRaw as Rec[], normalizeEdge);
  const rules = mapAll(rulesRaw as Rec[], normalizeRule);
  if (stages === null || edges === null || rules === null) return shape;

  const out: Rec = { ...raw };
  if (!hasOwn(out, 'schema_version')) out.schema_version = 1;
  out.identity = { ...identity };
  out.stages = stages;
  out.edges = edges;
  out.views = viewsRaw;
  out.rules = rules;
  out.text = { ...(isRec(raw.text) ? raw.text : {}), sections: sectionsRaw };
  out.theme = withDefaults(isRec(raw.theme) ? raw.theme : {}, { world: 'auto' });
  out.modules = modulesRaw;

  const preservedKeys = Object.keys(raw).filter((key) => !KNOWN_TOP_LEVEL.has(key));
  return { ok: true, doc: out as unknown as DraftDocument, preservedKeys };
}

/** The stage name `blankDocument` and `addStage` give a new stage: a number in the author's language. */
export function defaultStageName(base: Locale, n: number): LText {
  return base === 'en' ? ltext('en', `Stage ${n}`) : ltext('de', undefined, `Phase ${n}`);
}

/** A stage with every default set: roster, round robin once, best of 1, season ruleset, win 3, rank by points. */
export function newStage(key: string, name: LText): Stage {
  return {
    key,
    name,
    participants: { from: 'roster', seeding: 'rating' },
    pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
}

/** A new document with a name and one default stage; it compiles without an error. */
export function blankDocument(name: string, base: Locale): DraftDocument {
  return {
    schema_version: 1,
    identity: { name: base === 'en' ? ltext('en', name) : ltext('de', undefined, name) },
    stages: [newStage('stage_1', defaultStageName(base, 1))],
    edges: [],
    views: [],
    rules: [],
    text: { sections: [] },
    theme: { world: 'auto' },
    modules: [],
  };
}

const KEY_MAX_CHARS = 32;

/** A key-shaped version of arbitrary text: lower case, letters, digits and underscores, starting with a letter. */
function keyBase(raw: string): string {
  let base = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (!/^[a-z]/.test(base)) base = `k${base.startsWith('_') ? '' : '_'}${base}`;
  return base.slice(0, KEY_MAX_CHARS);
}

/**
 * `base`, else `base_2`, `base_3`, ...: the first one that is not taken. Always matches the key pattern and is at
 * most 32 characters long (the base is shortened to make room for the number).
 */
export function uniqueKey(taken: Iterable<string>, base: string): string {
  const used = new Set<string>();
  for (const key of taken) {
    if (typeof key === 'string') used.add(key);
  }
  const root = keyBase(base);
  if (KEY_PATTERN.test(root) && !used.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${root.slice(0, KEY_MAX_CHARS - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The canonical JSON of a document: the dirty baseline. Key order never changes it. */
export function documentSignature(doc: unknown): string {
  try {
    return canonicalizeJson(doc);
  } catch (error) {
    // A value that is not JSON (or too big) never equals a saved baseline, so the editor reads it as changed.
    return error instanceof JsonError ? `!${error.reason}:${error.pointer}` : '!not_json';
  }
}

function entryText(text: LText, locale: Locale): string {
  const entry = text[locale];
  return entry !== undefined && typeof entry.v === 'string' ? entry.v : '';
}

function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'de' : 'en';
}

function withoutLocale(text: LText, locale: Locale): LText {
  const out: LText = { base: text.base };
  const other = otherLocale(locale);
  if (text[other] !== undefined) out[other] = text[other] as LTextValue;
  return out;
}

/**
 * Sets one language of a text to `value` (status `human`, cut to the 4000-character limit is left to the validator).
 *
 * - An empty value on a language other than the base deletes that language.
 * - An empty value on the base language keeps `{ v: '' }` when it is the only language (so the field is flagged),
 *   and makes the other language the base when that one has text.
 * - An absent text plus a value creates a text whose base is that language; an absent text plus an empty value
 *   stays absent.
 * - A text whose `base` is missing or unknown gets `authorBase`.
 */
export function editLText(
  text: LText | undefined,
  locale: Locale,
  value: string,
  authorBase: Locale,
): LText | undefined {
  const entry: LTextValue = { v: value, s: 'human' };
  if (text === undefined) return value === '' ? undefined : { base: locale, [locale]: entry };

  const base: Locale = text.base === 'en' || text.base === 'de' ? text.base : authorBase;
  const current: LText = { ...text, base };
  if (value !== '') return { ...current, [locale]: entry };

  if (locale !== base) return withoutLocale(current, locale);
  const other = otherLocale(locale);
  if (entryText(current, other) !== '') {
    // The other language takes over as the base; this one is removed.
    return { ...withoutLocale(current, locale), base: other };
  }
  return { ...current, [locale]: entry };
}

/** Longest text a language keeps; exported for the ops that append words to a name. */
export const LTEXT_LIMIT = LTEXT_MAX_CHARS;
