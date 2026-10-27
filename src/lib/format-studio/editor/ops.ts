/**
 * The edit operations of the Studio editor: small, pure functions on a `DraftDocument`.
 *
 * Every operation is immutable (it never mutates its input and shares the branches it does not touch), never
 * throws for an index that is out of range (it returns its input), and never produces a key that breaks the key
 * pattern or repeats another key of the same kind. A limit (`MAX_STAGES` and the others) turns an add into a
 * no-op that reports `index: -1`; the UI disables the button and names the limit. An operation that changes
 * nothing returns the very same object, so a reducer can tell.
 *
 * Operations never write an `undefined` member (a document must stay plain JSON): an absent value is a missing
 * key. Text input never produces an error here: an emptied field stays in the document and the Issues tab flags it.
 */
import {
  KEY_PATTERN,
  MAX_EDGES,
  MAX_OVERRIDES,
  MAX_RANK_STEPS,
  MAX_RULES,
  MAX_SELECTS,
  MAX_STAGES,
  MAX_TEXT_SECTIONS,
  applyPatch,
  type AdvanceSelect,
  type Edge,
  type Fix,
  type GroupsSpec,
  type JsonValue,
  type Pairing,
  type RankStep,
  type RuleCard,
  type RulesetRef,
  type SeriesOverride,
  type Stage,
  type TextSection,
} from '@/lib/format-kit/client';
import type { LText } from '@/lib/studio-core/ltext';
import type { Locale } from '@/i18n/config';
import { LTEXT_LIMIT, defaultStageName, editLText, newStage, uniqueKey, type DraftDocument } from './document';
import { SEEDING_EDGES, SEEDING_ROSTER } from './catalog';

export interface RemovalSummary {
  edges: number;
  ruleCards: number;
  textSections: number;
  views: number;
}

const NONE: RemovalSummary = { edges: 0, ruleCards: 0, textSections: 0, views: 0 };

// ─── List helpers ────────────────────────────────────────────────────────────────────────────────

function inRange(list: readonly unknown[], i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < list.length;
}

function replaceAt<T>(list: readonly T[], i: number, item: T): T[] {
  const out = list.slice();
  out[i] = item;
  return out;
}

function removeAt<T>(list: readonly T[], i: number): T[] {
  return [...list.slice(0, i), ...list.slice(i + 1)];
}

function insertAt<T>(list: readonly T[], i: number, item: T): T[] {
  return [...list.slice(0, i), item, ...list.slice(i)];
}

/** The list with the item at `from` moved to `to` (clamped); the same list when nothing moves. */
function moveIn<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (!inRange(list, from) || !Number.isFinite(to)) return list;
  const target = Math.min(Math.max(Math.trunc(to), 0), list.length - 1);
  if (target === from) return list;
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const keysOf = (items: ReadonlyArray<{ key?: unknown }>): string[] =>
  items.flatMap((item) => (typeof item.key === 'string' ? [item.key] : []));

const idsOf = (items: ReadonlyArray<{ id?: unknown }>): string[] =>
  items.flatMap((item) => (typeof item.id === 'string' ? [item.id] : []));

/** A record without the members whose value is `undefined`. */
function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const member = (value as Record<string, unknown>)[key];
    if (member !== undefined) out[key] = member;
  }
  return out as T;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// ─── Stages ──────────────────────────────────────────────────────────────────────────────────────

/** The language a document is written in (the base of its name), English when it has none. */
function authorBaseOf(doc: DraftDocument): Locale {
  const base: unknown = doc.identity?.name?.base;
  return base === 'de' ? 'de' : 'en';
}

export function addStage(
  doc: DraftDocument,
  opts?: { after?: number },
): { doc: DraftDocument; index: number; key: string } {
  if (doc.stages.length >= MAX_STAGES) return { doc, index: -1, key: '' };
  const key = uniqueKey(keysOf(doc.stages), `stage_${doc.stages.length + 1}`);
  const at =
    opts?.after !== undefined && inRange(doc.stages, opts.after) ? opts.after + 1 : doc.stages.length;
  const stage = newStage(key, defaultStageName(authorBaseOf(doc), doc.stages.length + 1));
  return { doc: { ...doc, stages: insertAt(doc.stages, at, stage) }, index: at, key };
}

function appendWords(text: LText, suffix: Partial<Record<Locale, string>>): LText {
  const out: LText = { ...text };
  for (const locale of ['en', 'de'] as const) {
    const words = suffix[locale];
    const entry = text[locale];
    if (words === undefined || entry === undefined || typeof entry.v !== 'string') continue;
    const room = Math.max(0, LTEXT_LIMIT - words.length);
    out[locale] = { ...entry, v: `${entry.v.slice(0, room)}${words}` };
  }
  return out;
}

export function duplicateStage(
  doc: DraftDocument,
  index: number,
  suffix?: Partial<Record<Locale, string>>,
): { doc: DraftDocument; index: number; key: string } {
  if (!inRange(doc.stages, index) || doc.stages.length >= MAX_STAGES) return { doc, index: -1, key: '' };
  const source = doc.stages[index];
  const key = uniqueKey(keysOf(doc.stages), `${source.key}_copy`);
  const copy: Stage = { ...structuredClone(source), key };
  if (suffix !== undefined) copy.name = appendWords(copy.name, suffix);
  return { doc: { ...doc, stages: insertAt(doc.stages, index + 1, copy) }, index: index + 1, key };
}

/** True when another stage than `index` carries the same key (an invalid document), so references stay. */
function keyIsShared(doc: DraftDocument, index: number): boolean {
  const key = doc.stages[index].key;
  return doc.stages.some((stage, i) => i !== index && stage.key === key);
}

export function previewRemoveStage(doc: DraftDocument, index: number): RemovalSummary {
  if (!inRange(doc.stages, index) || keyIsShared(doc, index)) return NONE;
  const key = doc.stages[index].key;
  return {
    edges: doc.edges.filter((e) => e.from === key || e.to === key).length,
    ruleCards: doc.rules.filter((r) => r.scope?.kind === 'stage' && r.scope.stage === key).length,
    textSections: doc.text.sections.filter((s) => s.stage === key).length,
    views: doc.views.filter((v) => v.stages.includes(key)).length,
  };
}

export function removeStage(doc: DraftDocument, index: number): { doc: DraftDocument; removed: RemovalSummary } {
  if (!inRange(doc.stages, index)) return { doc, removed: NONE };
  const removed = previewRemoveStage(doc, index);
  const key = doc.stages[index].key;
  const stages = removeAt(doc.stages, index);
  if (keyIsShared(doc, index)) return { doc: { ...doc, stages }, removed };

  const edges = doc.edges.filter((e) => e.from !== key && e.to !== key);
  const rules = doc.rules.map((r): RuleCard =>
    r.scope?.kind === 'stage' && r.scope.stage === key ? { ...r, scope: { kind: 'season' } } : r,
  );
  const sections = doc.text.sections.map((s): TextSection => {
    if (s.stage !== key) return s;
    const { stage: _stage, ...rest } = s;
    return rest;
  });
  const views = doc.views
    .map((v) => (v.stages.includes(key) ? { ...v, stages: v.stages.filter((k) => k !== key) } : v))
    .filter((v) => v.stages.length >= 2);
  return { doc: { ...doc, stages, edges, rules, views, text: { ...doc.text, sections } }, removed };
}

export function moveStage(doc: DraftDocument, from: number, to: number): DraftDocument {
  const stages = moveIn(doc.stages, from, to);
  return stages === doc.stages ? doc : { ...doc, stages: stages as Stage[] };
}

export function renameStageKey(
  doc: DraftDocument,
  index: number,
  next: string,
): { ok: true; doc: DraftDocument } | { ok: false; reason: 'pattern' | 'taken' | 'unchanged' } {
  if (!inRange(doc.stages, index)) return { ok: false, reason: 'unchanged' };
  if (typeof next !== 'string' || !KEY_PATTERN.test(next)) return { ok: false, reason: 'pattern' };
  const previous = doc.stages[index].key;
  if (next === previous) return { ok: false, reason: 'unchanged' };
  if (doc.stages.some((stage, i) => i !== index && stage.key === next)) return { ok: false, reason: 'taken' };

  const stages = replaceAt(doc.stages, index, { ...doc.stages[index], key: next });
  if (keyIsShared(doc, index)) return { ok: true, doc: { ...doc, stages } };

  const rename = (key: string): string => (key === previous ? next : key);
  return {
    ok: true,
    doc: {
      ...doc,
      stages,
      edges: doc.edges.map((e) => (e.from === previous || e.to === previous ? { ...e, from: rename(e.from), to: rename(e.to) } : e)),
      rules: doc.rules.map((r): RuleCard =>
        r.scope?.kind === 'stage' && r.scope.stage === previous ? { ...r, scope: { kind: 'stage', stage: next } } : r,
      ),
      views: doc.views.map((v) => (v.stages.includes(previous) ? { ...v, stages: v.stages.map(rename) } : v)),
      text: {
        ...doc.text,
        sections: doc.text.sections.map((s) => (s.stage === previous ? { ...s, stage: next } : s)),
      },
    },
  };
}

export function updateStage(doc: DraftDocument, index: number, fn: (s: Stage) => Stage): DraftDocument {
  if (!inRange(doc.stages, index)) return doc;
  const next = fn(doc.stages[index]);
  return next === doc.stages[index] ? doc : { ...doc, stages: replaceAt(doc.stages, index, next) };
}

// ─── Stage setters ───────────────────────────────────────────────────────────────────────────────

export function setStageName(s: Stage, locale: Locale, value: string, authorBase: Locale): Stage {
  const name = editLText(s.name, locale, value, authorBase);
  return name === undefined || name === s.name ? s : { ...s, name };
}

export function setParticipantsFrom(s: Stage, from: 'roster' | 'edges'): Stage {
  if (s.participants.from === from) return s;
  return {
    ...s,
    participants: from === 'edges' ? { from: 'edges', seeding: 'edge_order' } : { from: 'roster', seeding: 'rating' },
  };
}

export function setSeeding(s: Stage, seeding: string): Stage {
  const allowed: readonly string[] = s.participants.from === 'roster' ? SEEDING_ROSTER : SEEDING_EDGES;
  if (!allowed.includes(seeding) || s.participants.seeding === seeding) return s;
  return { ...s, participants: { ...s.participants, seeding } as Stage['participants'] };
}

export function setExpectedCount(s: Stage, n: number | undefined): Stage {
  if (s.participants.from !== 'roster') return s;
  const { expected_count: _previous, ...rest } = s.participants;
  if (n === undefined) {
    return s.participants.expected_count === undefined ? s : { ...s, participants: rest };
  }
  if (!isFiniteNumber(n) || s.participants.expected_count === n) return s;
  return { ...s, participants: { ...rest, expected_count: n } };
}

/** The groups a stage gets when the form turns them on. */
export const DEFAULT_GROUPS: GroupsSpec = { count: 2, method: 'serpentine' };

export function setGroups(s: Stage, g: GroupsSpec | undefined): Stage {
  if (g === undefined) {
    if (s.groups === undefined) return s;
    const { groups: _groups, ...rest } = s;
    return rest;
  }
  return { ...s, groups: { ...g } };
}

const PAIRING_DEFAULTS: { readonly [K in Pairing['kind']]: Extract<Pairing, { kind: K }> } = {
  round_robin: { kind: 'round_robin', legs: 1, mirror_legs: true },
  swiss: { kind: 'swiss', rounds: 'auto', avoid_repeats: true },
  single_elim: { kind: 'single_elim', third_place: false },
  double_elim: { kind: 'double_elim', bracket_reset: false },
  manual: { kind: 'manual' },
};

export function setPairingKind(s: Stage, kind: Pairing['kind']): Stage {
  if (s.pairing.kind === kind || !hasOwn(PAIRING_DEFAULTS, kind)) return s;
  return { ...s, pairing: { ...PAIRING_DEFAULTS[kind] } };
}

const PAIRING_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  round_robin: ['legs', 'mirror_legs'],
  swiss: ['rounds', 'avoid_repeats'],
  single_elim: ['third_place'],
  double_elim: ['bracket_reset'],
  manual: [],
};

/** Sets members of the current pairing kind; members of another kind (and `kind` itself) are ignored. */
export function patchPairing(s: Stage, patch: Record<string, unknown>): Stage {
  const members = hasOwn(PAIRING_MEMBERS, s.pairing.kind) ? PAIRING_MEMBERS[s.pairing.kind] : [];
  const current = s.pairing as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  let changed = false;
  for (const member of members) {
    if (!hasOwn(patch, member) || patch[member] === undefined) continue;
    if (next[member] !== patch[member]) {
      next[member] = patch[member];
      changed = true;
    }
  }
  return changed ? { ...s, pairing: next as unknown as Pairing } : s;
}

export function setBestOf(s: Stage, n: number): Stage {
  if (!isFiniteNumber(n) || s.series.best_of === n) return s;
  return { ...s, series: { ...s.series, best_of: n } };
}

export function addOverride(s: Stage): Stage {
  const overrides = s.series.overrides;
  if (overrides.length >= MAX_OVERRIDES) return s;
  const taken = new Set(overrides.filter((o) => o.from === 'start').map((o) => o.round));
  let round = 1;
  while (taken.has(round)) round += 1;
  const added: SeriesOverride = { round, from: 'start', best_of: s.series.best_of };
  return { ...s, series: { ...s.series, overrides: [...overrides, added] } };
}

export function patchOverride(s: Stage, i: number, p: Partial<SeriesOverride>): Stage {
  const overrides = s.series.overrides;
  if (!inRange(overrides, i)) return s;
  const next: SeriesOverride = compact({ ...overrides[i], ...compact(p) });
  const same = next.round === overrides[i].round && next.from === overrides[i].from && next.best_of === overrides[i].best_of;
  return same ? s : { ...s, series: { ...s.series, overrides: replaceAt(overrides, i, next) } };
}

export function removeOverride(s: Stage, i: number): Stage {
  const overrides = s.series.overrides;
  if (!inRange(overrides, i)) return s;
  return { ...s, series: { ...s.series, overrides: removeAt(overrides, i) } };
}

export function setRuleset(s: Stage, ref: RulesetRef): Stage {
  return { ...s, ruleset: { ...ref } };
}

export function setScoreValue(s: Stage, key: 'win' | 'loss' | 'bye', n: number): Stage {
  if (!isFiniteNumber(n) || s.scoring[key] === n) return s;
  return { ...s, scoring: { ...s.scoring, [key]: n } };
}

export function setDoubles(s: Stage, doubles: boolean): Stage {
  return s.doubles === doubles ? s : { ...s, doubles };
}

function newRankStep(kind: RankStep['kind']): RankStep {
  switch (kind) {
    case 'metric':
      return { kind: 'metric', metric: 'points', direction: 'desc' };
    case 'head_to_head':
      return { kind: 'head_to_head', scope: 'pairwise' };
    default:
      return { kind };
  }
}

export function addRankStep(s: Stage, kind: RankStep['kind']): Stage {
  if (s.rank.length >= MAX_RANK_STEPS) return s;
  return { ...s, rank: [...s.rank, newRankStep(kind)] };
}

const RANK_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  metric: ['metric', 'direction'],
  head_to_head: ['scope'],
};

export function patchRankStep(s: Stage, i: number, p: Record<string, unknown>): Stage {
  if (!inRange(s.rank, i)) return s;
  const step = s.rank[i];
  const members = hasOwn(RANK_MEMBERS, step.kind) ? RANK_MEMBERS[step.kind] : [];
  const next: Record<string, unknown> = { ...step };
  let changed = false;
  for (const member of members) {
    if (!hasOwn(p, member) || p[member] === undefined) continue;
    if (next[member] !== p[member]) {
      next[member] = p[member];
      changed = true;
    }
  }
  return changed ? { ...s, rank: replaceAt(s.rank, i, next as unknown as RankStep) } : s;
}

export function removeRankStep(s: Stage, i: number): Stage {
  return inRange(s.rank, i) ? { ...s, rank: removeAt(s.rank, i) } : s;
}

export function moveRankStep(s: Stage, from: number, to: number): Stage {
  const rank = moveIn(s.rank, from, to);
  return rank === s.rank ? s : { ...s, rank: rank as RankStep[] };
}

// ─── Edges ───────────────────────────────────────────────────────────────────────────────────────

export function addEdge(
  doc: DraftDocument,
  opts?: { from?: string; to?: string },
): { doc: DraftDocument; index: number; key: string } {
  if (doc.edges.length >= MAX_EDGES) return { doc, index: -1, key: '' };
  const stageKeys = keysOf(doc.stages);
  const from = opts?.from ?? stageKeys[0] ?? '';
  const after = stageKeys.indexOf(from);
  const to = opts?.to ?? stageKeys[after + 1] ?? stageKeys.find((k) => k !== from) ?? '';
  const key = uniqueKey(keysOf(doc.edges), `edge_${doc.edges.length + 1}`);
  const edge: Edge = { key, from, to, select: [{ kind: 'top_n', n: 2 }], seeding: 'rank', gate: 'admin_confirm' };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, index: doc.edges.length, key };
}

export function removeEdge(doc: DraftDocument, i: number): DraftDocument {
  return inRange(doc.edges, i) ? { ...doc, edges: removeAt(doc.edges, i) } : doc;
}

export function moveEdge(doc: DraftDocument, from: number, to: number): DraftDocument {
  const edges = moveIn(doc.edges, from, to);
  return edges === doc.edges ? doc : { ...doc, edges: edges as Edge[] };
}

export function updateEdge(doc: DraftDocument, i: number, fn: (e: Edge) => Edge): DraftDocument {
  if (!inRange(doc.edges, i)) return doc;
  const next = fn(doc.edges[i]);
  return next === doc.edges[i] ? doc : { ...doc, edges: replaceAt(doc.edges, i, next) };
}

type EditableSelectKind = Exclude<AdvanceSelect['kind'], 'threshold'>;

function newSelect(kind: EditableSelectKind): AdvanceSelect {
  return kind === 'manual_list' ? { kind: 'manual_list' } : { kind, n: 2 };
}

export function addSelect(e: Edge, kind: EditableSelectKind): Edge {
  if (e.select.length >= MAX_SELECTS) return e;
  return { ...e, select: [...e.select, newSelect(kind)] };
}

export function removeSelect(e: Edge, j: number): Edge {
  return inRange(e.select, j) ? { ...e, select: removeAt(e.select, j) } : e;
}

/**
 * Edits a selection: its number (`n`), the optional count of a hand-picked list (`count`; `undefined` clears it) or
 * its kind. The kind changes between `top_n`, `per_group`, `wildcard` and `bottom_n` keeping `n`, and to or from
 * `manual_list`, which has a count instead of `n`. A threshold selection is never changed.
 */
export function patchSelect(
  e: Edge,
  j: number,
  p: { n?: number; count?: number | undefined; kind?: EditableSelectKind },
): Edge {
  if (!inRange(e.select, j)) return e;
  const current = e.select[j];
  if (current.kind === 'threshold') return e;

  let next: AdvanceSelect = current;
  if (p.kind !== undefined && p.kind !== current.kind) {
    next = p.kind === 'manual_list' ? { kind: 'manual_list' } : { kind: p.kind, n: current.kind === 'manual_list' ? 2 : current.n };
  }
  if (next.kind === 'manual_list') {
    if (hasOwn(p, 'count')) {
      next = isFiniteNumber(p.count) ? { kind: 'manual_list', count: p.count } : { kind: 'manual_list' };
    }
  } else if (next.kind !== 'threshold' && isFiniteNumber(p.n) && next.n !== p.n) {
    next = { kind: next.kind, n: p.n };
  }
  const same = JSON.stringify(next) === JSON.stringify(current);
  return same ? e : { ...e, select: replaceAt(e.select, j, next) };
}

// ─── Rule cards and text sections ────────────────────────────────────────────────────────────────

function emptyText(base: Locale): LText {
  return { base, [base]: { v: '', s: 'human' } };
}

export function addRuleCard(doc: DraftDocument, authorBase: Locale): { doc: DraftDocument; index: number; id: string } {
  if (doc.rules.length >= MAX_RULES) return { doc, index: -1, id: '' };
  const id = uniqueKey(idsOf(doc.rules), `rule_${doc.rules.length + 1}`);
  const card: RuleCard = {
    kind: 'rule.custom',
    id,
    text: emptyText(authorBase),
    scope: { kind: 'season' },
    verify: 'admin_checklist',
    when: 'once',
    visible_to_players: true,
  };
  return { doc: { ...doc, rules: [...doc.rules, card] }, index: doc.rules.length, id };
}

export function updateRuleCard(doc: DraftDocument, i: number, fn: (c: RuleCard) => RuleCard): DraftDocument {
  if (!inRange(doc.rules, i)) return doc;
  const next = fn(doc.rules[i]);
  return next === doc.rules[i] ? doc : { ...doc, rules: replaceAt(doc.rules, i, next) };
}

export function removeRuleCard(doc: DraftDocument, i: number): DraftDocument {
  return inRange(doc.rules, i) ? { ...doc, rules: removeAt(doc.rules, i) } : doc;
}

export function moveRuleCard(doc: DraftDocument, from: number, to: number): DraftDocument {
  const rules = moveIn(doc.rules, from, to);
  return rules === doc.rules ? doc : { ...doc, rules: rules as RuleCard[] };
}

export function duplicateRuleCard(doc: DraftDocument, i: number): { doc: DraftDocument; index: number; id: string } {
  if (!inRange(doc.rules, i) || doc.rules.length >= MAX_RULES) return { doc, index: -1, id: '' };
  const id = uniqueKey(idsOf(doc.rules), `${doc.rules[i].id}_copy`);
  const copy: RuleCard = { ...structuredClone(doc.rules[i]), id };
  return { doc: { ...doc, rules: insertAt(doc.rules, i + 1, copy) }, index: i + 1, id };
}

export function addTextSection(
  doc: DraftDocument,
  authorBase: Locale,
): { doc: DraftDocument; index: number; id: string } {
  const sections = doc.text.sections;
  if (sections.length >= MAX_TEXT_SECTIONS) return { doc, index: -1, id: '' };
  const id = uniqueKey(idsOf(sections), `section_${sections.length + 1}`);
  const section: TextSection = { id, title: emptyText(authorBase), body: emptyText(authorBase) };
  return { doc: { ...doc, text: { ...doc.text, sections: [...sections, section] } }, index: sections.length, id };
}

export function updateTextSection(doc: DraftDocument, i: number, fn: (s: TextSection) => TextSection): DraftDocument {
  const sections = doc.text.sections;
  if (!inRange(sections, i)) return doc;
  const next = fn(sections[i]);
  return next === sections[i] ? doc : { ...doc, text: { ...doc.text, sections: replaceAt(sections, i, next) } };
}

export function removeTextSection(doc: DraftDocument, i: number): DraftDocument {
  const sections = doc.text.sections;
  return inRange(sections, i) ? { ...doc, text: { ...doc.text, sections: removeAt(sections, i) } } : doc;
}

export function moveTextSection(doc: DraftDocument, from: number, to: number): DraftDocument {
  const sections = moveIn(doc.text.sections, from, to);
  return sections === doc.text.sections ? doc : { ...doc, text: { ...doc.text, sections: sections as TextSection[] } };
}

// ─── Identity and theme ──────────────────────────────────────────────────────────────────────────

function hasAnyText(text: LText): boolean {
  return (['en', 'de'] as const).some((locale) => (text[locale]?.v ?? '') !== '');
}

export function setIdentityText(
  doc: DraftDocument,
  field: 'name' | 'summary',
  locale: Locale,
  value: string,
): DraftDocument {
  const authorBase = authorBaseOf(doc);
  if (field === 'name') {
    const name = editLText(doc.identity.name, locale, value, authorBase);
    return name === undefined || name === doc.identity.name ? doc : { ...doc, identity: { ...doc.identity, name } };
  }
  const summary = editLText(doc.identity.summary, locale, value, authorBase);
  if (summary === undefined || !hasAnyText(summary)) {
    if (doc.identity.summary === undefined) return doc;
    const { summary: _summary, ...identity } = doc.identity;
    return { ...doc, identity };
  }
  return { ...doc, identity: { ...doc.identity, summary } };
}

export function setTheme(doc: DraftDocument, world: 'auto' | string): DraftDocument {
  return doc.theme.world === world ? doc : { ...doc, theme: { ...doc.theme, world } };
}

// ─── Fixes ───────────────────────────────────────────────────────────────────────────────────────

/** Applies a compiler fix (a JSON patch). Fails when the patch no longer fits the document. */
export function applyFix(doc: DraftDocument, fix: Fix): { ok: true; doc: DraftDocument } | { ok: false } {
  const result = applyPatch(doc as unknown as JsonValue, fix.patch);
  return result.ok ? { ok: true, doc: result.value as unknown as DraftDocument } : { ok: false };
}

/** The editor-level fix for an unknown or reserved member: removes the value at a pointer. */
export function removeAtPointer(doc: DraftDocument, pointer: string): { ok: true; doc: DraftDocument } | { ok: false } {
  const result = applyPatch(doc as unknown as JsonValue, [{ op: 'remove', path: pointer }]);
  return result.ok ? { ok: true, doc: result.value as unknown as DraftDocument } : { ok: false };
}
