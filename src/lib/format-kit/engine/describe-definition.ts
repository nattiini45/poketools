/**
 * Whole-definition renderer (client-safe): a format definition in, plain-language blocks out, in the viewer's
 * language. It is the read-only face of the kit: the Studio shows these blocks, and `definitionToPlainText`
 * joins them into the text of a rules page.
 *
 * - Sentences about one primitive come from `describePrimitive` (`format-studio/primitives`); the sentences only a
 *   whole document needs (overview, participants, plan, seeding and gate words, coverage line, headings) come from
 *   `format-studio/describe`. Names resolve with `resolveLText({ viewer: locale })`, so a text missing in the
 *   viewer's language falls back through the usual order.
 * - Every function is pure and never throws: the input is read defensively (any value is safe, a stage that does
 *   not exist gives `null`, a node of the wrong shape gives its key or its kind label), nothing is mutated, and
 *   the output holds plain strings, numbers and booleans only.
 * - Coverage (`computeCoverage`) is locale-free: it counts the rule units of a definition by how they are
 *   enforced. `auto` units are run by the engine, `checked` units compute a result an admin confirms, `honor`
 *   units are rule cards nobody enforces and `legacy` units are modules that carry data of an existing format.
 *   Nothing executes in this release, so the buckets state the intended enforcement of each primitive
 *   (`manifestEntry(kind).level`).
 */
import type { Locale } from '@/i18n/config';
import { createTranslator, type Translator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { formatStudioDescribeMessages } from '@/i18n/messages/format-studio/describe';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { resolveLText, type LText } from '@/lib/studio-core/ltext';
import { describePrimitive } from '../registry/describe';
import type { PrimitiveKind } from '../registry/kinds';
import { manifestEntry } from '../registry/manifest';
import type { FormatDefinition } from '../types';
import type { StagePlan } from './plan';

/** Rule units of a definition by how they are enforced; `total` is the sum of the four buckets. */
export interface Coverage {
  auto: number;
  checked: number;
  honor: number;
  legacy: number;
  total: number;
}

export interface DescribeOptions {
  /** The compiler's plan: adds the expected counts to each stage. */
  plan?: readonly StagePlan[];
  /** Stage keys in display order (the graph order); stages missing from it follow in declaration order. */
  order?: readonly string[];
  /** Stored ruleset ids with their names, for the ruleset sentence of a stage. */
  rulesets?: readonly { id: string; name: string }[];
}

export interface StageDescription {
  key: string;
  name: string;
  /** The `stage.define` sentence: name, pairing, series length, scoring and rank chain. */
  summary: string;
  participants: string;
  groups: string | null;
  pairing: string;
  series: string;
  ruleset: string;
  scoring: string;
  /** Doubles and players-per-match words; null for a plain two-player stage. */
  doubles: string | null;
  /** One sentence per rank step, in order. */
  rankSteps: string[];
  /** The whole rank chain as one sentence; null without rank steps. */
  rankChain: string | null;
  /** Participant range, rounds, byes or bracket size from the plan; null without a plan entry. */
  expected: string | null;
  /** One sentence per advancement rule that leads into this stage. */
  incoming: string[];
  /** One sentence per advancement rule that leaves this stage. */
  outgoing: string[];
}

export interface ModuleDescription {
  adapter: 'epb' | 'legacy_draft' | 'core_liga';
  label: string;
  summary: string;
  facts: { key: string; label: string; value: string }[];
}

export interface RuleCardDescription {
  id: string;
  text: string;
  verify: string;
  when: string;
  visibleToPlayers: boolean;
}

export interface DefinitionDescription {
  locale: Locale;
  title: string;
  summary: string | null;
  overview: string;
  stages: StageDescription[];
  /** One sentence per advancement rule, in document order. */
  advancement: string[];
  views: string[];
  rules: RuleCardDescription[];
  modules: ModuleDescription[];
  /** `stage` is the display name of the stage a section belongs to, or null for a section of the whole format. */
  sections: { id: string; title: string; body: string; stage: string | null }[];
  coverage: Coverage;
  coverageLine: string;
}

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const recOf = (value: unknown): Rec => (isRec(value) ? value : {});
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strOf = (node: Rec, name: string): string | null =>
  Object.prototype.hasOwnProperty.call(node, name) && typeof node[name] === 'string' ? (node[name] as string) : null;
const numOf = (node: Rec, name: string): number | null =>
  Object.prototype.hasOwnProperty.call(node, name) && typeof node[name] === 'number' && Number.isFinite(node[name])
    ? (node[name] as number)
    : null;

function textOf(value: unknown, locale: Locale): string | null {
  if (!isRec(value)) return null;
  return resolveLText(value as unknown as LText, { viewer: locale })?.value ?? null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// --- Coverage ---------------------------------------------------------------------------------

type Bucket = 'auto' | 'checked' | 'honor';

function levelOf(kind: string): Bucket {
  const level = manifestEntry(kind)?.level;
  return level === 'checked' || level === 'honor' ? level : 'auto';
}

/**
 * Counts the rule units of a definition. Per stage: one pairing, one series, one scoring, one groups unit when the
 * stage splits into groups, one per rank step and one when the stage names a ruleset (a stored one or a rule
 * preset). Per advancement rule: one per selection, `checked` under the `admin_confirm` gate and `auto` otherwise.
 * Per combined standings view: one. Every rule card is an `honor` unit and every module a `legacy` unit.
 * Locale-free; any value is safe.
 */
export function computeCoverage(def: FormatDefinition): Coverage {
  const cov: Coverage = { auto: 0, checked: 0, honor: 0, legacy: 0, total: 0 };
  const root = recOf(def);
  for (const entry of listOf(root.stages)) {
    if (!isRec(entry)) continue;
    const pairingTag = strOf(recOf(entry.pairing), 'kind');
    cov[levelOf(pairingTag === null ? 'pairing.manual' : `pairing.${pairingTag}`)] += 1;
    cov[levelOf('series.rule')] += 1;
    cov[levelOf('score.match')] += 1;
    if (isRec(entry.groups)) cov[levelOf('group.form')] += 1;
    for (const step of listOf(entry.rank)) {
      if (isRec(step)) cov[levelOf(`rank.${strOf(step, 'kind') ?? 'manual'}`)] += 1;
    }
    const rulesetKind = strOf(recOf(entry.ruleset), 'kind');
    if (rulesetKind === 'ruleset' || rulesetKind === 'preset') cov[levelOf('team.ruleset')] += 1;
  }
  for (const edge of listOf(root.edges)) {
    if (!isRec(edge)) continue;
    const confirmed = strOf(edge, 'gate') === 'admin_confirm';
    for (const select of listOf(edge.select)) {
      if (!isRec(select)) continue;
      if (confirmed) cov.checked += 1;
      else cov[levelOf(`advance.${strOf(select, 'kind') ?? 'manual_list'}`)] += 1;
    }
  }
  for (const view of listOf(root.views)) {
    if (isRec(view)) cov[levelOf('standings.view')] += 1;
  }
  for (const rule of listOf(root.rules)) {
    if (isRec(rule)) cov.honor += 1;
  }
  for (const entry of listOf(root.modules)) {
    if (isRec(entry)) cov.legacy += 1;
  }
  cov.total = cov.auto + cov.checked + cov.honor + cov.legacy;
  return cov;
}

// --- Context ----------------------------------------------------------------------------------

type DescribeT = Translator<typeof formatStudioDescribeMessages.en>;
type PrimitiveT = Translator<typeof formatStudioPrimitivesMessages.en>;

interface Ctx {
  readonly locale: Locale;
  readonly t: DescribeT;
  readonly p: PrimitiveT;
  readonly rulesets: ReadonlyMap<string, string>;
  /** Display name of a stage key (the key itself when the stage does not exist or has no text). */
  stageName(key: string | null): string;
  list(items: readonly string[]): string;
  number(value: number): string;
}

function makeCtx(def: unknown, locale: Locale, opts: DescribeOptions | undefined): Ctx {
  const t = createTranslator(formatStudioDescribeMessages, locale);
  const p = createTranslator(formatStudioPrimitivesMessages, locale);
  const format = createFormatter({ locale, timeZone: 'UTC' });
  const names = new Map<string, string>();
  for (const stage of listOf(recOf(def).stages)) {
    if (!isRec(stage)) continue;
    const key = strOf(stage, 'key');
    if (key !== null && !names.has(key)) names.set(key, textOf(stage.name, locale) ?? key);
  }
  const rulesets = new Map<string, string>();
  for (const entry of listOf(opts?.rulesets)) {
    if (!isRec(entry)) continue;
    const id = strOf(entry, 'id');
    const name = strOf(entry, 'name');
    if (id !== null && name !== null && name !== '' && !rulesets.has(id)) rulesets.set(id, name);
  }
  return {
    locale,
    t,
    p,
    rulesets,
    stageName: (key) => (key === null ? '' : (names.get(key) ?? key)),
    list: (items) => (items.length === 0 ? '' : format.list(items)),
    number: (value) => format.number(value),
  };
}

const describe = (kind: string, node: unknown, locale: Locale): string =>
  describePrimitive(kind as PrimitiveKind, node, locale);

// --- Stage blocks -----------------------------------------------------------------------------

function participantsSentence(stage: Rec, c: Ctx): string {
  const participants = recOf(stage.participants);
  const from = strOf(participants, 'from');
  const seeding = strOf(participants, 'seeding');
  const key = `participants.${from}_${seeding}`;
  let sentence = c.t.has(key)
    ? c.t.dynamic(key)
    : c.p.dynamic(`option.from_${from}`, undefined, c.p.dynamic('field.participants', undefined, 'Participants'));
  const expected = numOf(participants, 'expected_count');
  if (from === 'roster' && expected !== null) sentence += ` ${c.t('participants.roster_expected', { count: expected })}`;
  return sentence;
}

function rulesetSentence(stage: Rec, c: Ctx): string {
  const ruleset = recOf(stage.ruleset);
  const id = strOf(ruleset, 'id');
  const name = id === null ? undefined : c.rulesets.get(id);
  if (strOf(ruleset, 'kind') === 'ruleset' && name !== undefined) return c.t('stage.ruleset_named', { name });
  return describe('team.ruleset', ruleset, c.locale);
}

function doublesSentence(stage: Rec, c: Ctx): string | null {
  const parts: string[] = [];
  if (stage.doubles === true) parts.push(c.t('stage.doubles'));
  const players = numOf(stage, 'players_per_match');
  if (players !== null && players !== 2) parts.push(c.t('stage.players', { count: players }));
  return parts.length === 0 ? null : parts.join(' ');
}

function rankItem(step: Rec, c: Ctx): string | null {
  const kind = strOf(step, 'kind');
  switch (kind) {
    case 'metric': {
      const metric = strOf(step, 'metric');
      const direction = strOf(step, 'direction');
      if (metric === null || direction === null) return null;
      return c.p.dynamic('item.rank_metric', {
        metric: c.p.dynamic(`metric.${metric}`, undefined, metric),
        direction: c.p.dynamic(`option.direction_${direction}`, undefined, direction),
      });
    }
    case 'head_to_head': {
      const scope = strOf(step, 'scope');
      if (scope === null) return null;
      return c.p.dynamic('item.rank_head_to_head', { scope: c.p.dynamic(`option.scope_${scope}`, undefined, scope) });
    }
    case 'coin_flip':
    case 'decision_match':
    case 'manual':
      return c.p.dynamic(`item.rank_${kind}`);
    default:
      return null;
  }
}

function range(value: unknown): { min: number; max: number } | null {
  if (!isRec(value)) return null;
  const min = numOf(value, 'min');
  const max = numOf(value, 'max');
  return min === null || max === null ? null : { min, max };
}

function expectedSentence(plan: StagePlan | undefined, c: Ctx): string | null {
  if (plan === undefined) return null;
  const entry = recOf(plan);
  const parts: string[] = [];
  const participants = range(entry.participants);
  if (participants !== null) {
    parts.push(
      participants.min === participants.max
        ? c.t('plan.participants_exact', { count: participants.min })
        : c.t('plan.participants_range', { min: participants.min, max: participants.max }),
    );
  }
  const rounds = range(entry.rounds);
  if (rounds !== null) {
    parts.push(
      rounds.min === rounds.max
        ? c.t('plan.rounds', { count: rounds.min })
        : c.t('plan.rounds_range', { min: rounds.min, max: rounds.max }),
    );
  }
  const size = numOf(entry, 'bracketSize');
  if (size !== null) parts.push(c.t('plan.bracket', { size }));
  const byes = numOf(entry, 'byes');
  if (byes !== null && byes > 0) parts.push(c.t('plan.byes', { count: byes }));
  return parts.length === 0 ? null : parts.join(' ');
}

function edgeSentence(edge: Rec, c: Ctx): string {
  const rule = describe(
    'advance.rule',
    { ...edge, from: c.stageName(strOf(edge, 'from')), to: c.stageName(strOf(edge, 'to')) },
    c.locale,
  );
  const seedingKey = `edge.seeding_${strOf(edge, 'seeding')}`;
  const gateKey = `edge.gate_${strOf(edge, 'gate')}`;
  return squash(
    c.t('edge.line', {
      rule,
      seeding: c.t.has(seedingKey) ? c.t.dynamic(seedingKey) : '',
      gate: c.t.has(gateKey) ? c.t.dynamic(gateKey) : '',
    }),
  );
}

function edgesOf(def: unknown): Rec[] {
  return listOf(recOf(def).edges).filter(isRec);
}

function buildStage(def: unknown, stage: Rec, key: string, c: Ctx, plan: StagePlan | undefined): StageDescription {
  const name = textOf(stage.name, c.locale) ?? key;
  const steps = listOf(stage.rank).filter(isRec);
  const items = steps.map((step) => rankItem(step, c)).filter((item): item is string => item !== null);
  const edges = edgesOf(def);
  return {
    key,
    name,
    summary: describe('stage.define', stage, c.locale),
    participants: participantsSentence(stage, c),
    groups: isRec(stage.groups) ? describe('group.form', stage.groups, c.locale) : null,
    pairing: describe(`pairing.${strOf(recOf(stage.pairing), 'kind') ?? 'manual'}`, stage.pairing, c.locale),
    series: describe('series.rule', stage.series, c.locale),
    ruleset: rulesetSentence(stage, c),
    scoring: describe('score.match', stage.scoring, c.locale),
    doubles: doublesSentence(stage, c),
    rankSteps: steps.map((step) => describe(`rank.${strOf(step, 'kind') ?? 'manual'}`, step, c.locale)),
    rankChain: items.length === 0 ? null : c.p.dynamic('describe.rank_chain', { steps: c.list(items) }),
    expected: expectedSentence(plan, c),
    incoming: edges.filter((edge) => strOf(edge, 'to') === key).map((edge) => edgeSentence(edge, c)),
    outgoing: edges.filter((edge) => strOf(edge, 'from') === key).map((edge) => edgeSentence(edge, c)),
  };
}

function planByKey(opts: DescribeOptions | undefined): Map<string, StagePlan> {
  const plans = new Map<string, StagePlan>();
  for (const entry of listOf(opts?.plan)) {
    const key = isRec(entry) ? strOf(entry, 'key') : null;
    if (key !== null && !plans.has(key)) plans.set(key, entry as StagePlan);
  }
  return plans;
}

/** The description of the first stage with this key, or null when there is none. Never throws. */
export function describeStage(
  def: FormatDefinition,
  stageKey: string,
  locale: Locale,
  opts?: DescribeOptions,
): StageDescription | null {
  const stage = listOf(recOf(def).stages).find((s): s is Rec => isRec(s) && strOf(s, 'key') === stageKey);
  if (stage === undefined) return null;
  const empty: StageDescription = {
    key: stageKey,
    name: stageKey,
    summary: stageKey,
    participants: '',
    groups: null,
    pairing: '',
    series: '',
    ruleset: '',
    scoring: '',
    doubles: null,
    rankSteps: [],
    rankChain: null,
    expected: null,
    incoming: [],
    outgoing: [],
  };
  return safe(() => buildStage(def, stage, stageKey, makeCtx(def, locale, opts), planByKey(opts).get(stageKey)), empty);
}

// --- Whole definition -------------------------------------------------------------------------

function formatFact(value: unknown, c: Ctx): string {
  if (typeof value === 'boolean') return value ? c.t('bool.yes') : c.t('bool.no');
  if (typeof value === 'number' && Number.isFinite(value)) return c.number(value);
  if (typeof value === 'string') {
    const key = `factValue.${value}`;
    return c.t.has(key) ? c.t.dynamic(key) : value;
  }
  return '';
}

function buildModule(entry: Rec, c: Ctx): ModuleDescription {
  const adapter = strOf(entry, 'adapter') ?? '';
  const facts = listOf(entry.facts)
    .filter(isRec)
    .map((fact) => {
      const key = strOf(fact, 'key') ?? '';
      return { key, label: textOf(fact.label, c.locale) ?? key, value: formatFact(fact.value, c) };
    });
  return {
    adapter: adapter as ModuleDescription['adapter'],
    label: c.p.dynamic(`option.adapter_${adapter}`, undefined, adapter),
    summary: describe('module.legacy', entry, c.locale),
    facts,
  };
}

function buildRule(entry: Rec, c: Ctx): RuleCardDescription {
  const verifyKey = `rule.verify_${strOf(entry, 'verify')}`;
  const whenKey = `rule.when_${strOf(entry, 'when')}`;
  const scope = recOf(entry.scope);
  const when = [
    c.t.has(whenKey) ? c.t.dynamic(whenKey) : '',
    strOf(scope, 'kind') === 'stage' ? c.t('rule.scope_stage', { stage: c.stageName(strOf(scope, 'stage')) }) : '',
  ];
  return {
    id: strOf(entry, 'id') ?? '',
    text: describe('rule.custom', entry, c.locale),
    verify: c.t.has(verifyKey) ? c.t.dynamic(verifyKey) : '',
    when: squash(when.join(' ')),
    visibleToPlayers: entry.visible_to_players !== false,
  };
}

function coverageSentence(cov: Coverage, locale: Locale): string {
  const t = createTranslator(formatStudioDescribeMessages, locale);
  if (cov.total === 0) return t('coverage.none');
  const parts: string[] = [];
  for (const bucket of ['auto', 'checked', 'honor', 'legacy'] as const) {
    const count = cov[bucket];
    if (count > 0) parts.push(t('coverage.part', { count, level: t.dynamic(`level.${bucket}`, { count }) }));
  }
  return t('coverage.line', { parts: parts.join(t('coverage.separator')) });
}

/** The coverage buckets as one sentence in `locale`; zero buckets are left out. Never throws. */
export function describeCoverage(cov: Coverage, locale: Locale): string {
  return safe(() => coverageSentence(cov, locale), '');
}

/** Stages in display order: `opts.order` first (each stage once), the rest in declaration order. */
function orderedStages(def: unknown, opts: DescribeOptions | undefined): { stage: Rec; key: string }[] {
  const declared = listOf(recOf(def).stages)
    .filter(isRec)
    .map((stage) => ({ stage, key: strOf(stage, 'key') ?? '' }));
  const used = new Set<Rec>();
  const out: { stage: Rec; key: string }[] = [];
  for (const wanted of listOf(opts?.order)) {
    const hit = declared.find((entry) => entry.key === wanted && !used.has(entry.stage));
    if (hit !== undefined) {
      used.add(hit.stage);
      out.push(hit);
    }
  }
  for (const entry of declared) {
    if (!used.has(entry.stage)) out.push(entry);
  }
  return out;
}

/** The whole definition as blocks in `locale`. Never throws; nothing in it is localized beyond `locale`. */
export function describeDefinition(def: FormatDefinition, locale: Locale, opts?: DescribeOptions): DefinitionDescription {
  const c = makeCtx(def, locale, opts);
  const root = recOf(def);
  const plans = planByKey(opts);
  const ordered = safe(() => orderedStages(def, opts), []);
  const stages = ordered.flatMap(({ stage, key }) =>
    safe(
      () => [buildStage(def, stage, key, c, plans.get(key))],
      [] as StageDescription[],
    ),
  );
  const coverage = safe(() => computeCoverage(def), { auto: 0, checked: 0, honor: 0, legacy: 0, total: 0 });
  const identity = recOf(root.identity);
  const names = stages.map((stage) => stage.name);
  return {
    locale,
    title: safe(() => textOf(identity.name, locale), null) ?? c.t('overview.untitled'),
    summary: safe(() => textOf(identity.summary, locale), null),
    overview: safe(
      () =>
        names.length === 0
          ? c.t('overview.none')
          : c.t('overview.stages', { count: names.length, list: c.list(names) }),
      '',
    ),
    stages,
    advancement: safe(() => edgesOf(def).map((edge) => edgeSentence(edge, c)), []),
    views: safe(
      () => listOf(root.views).filter(isRec).map((view) => describe('standings.view', view, locale)),
      [],
    ),
    rules: safe(() => listOf(root.rules).filter(isRec).map((rule) => buildRule(rule, c)), []),
    modules: safe(() => listOf(root.modules).filter(isRec).map((entry) => buildModule(entry, c)), []),
    sections: safe(
      () =>
        listOf(recOf(root.text).sections)
          .filter(isRec)
          .map((section) => {
            const id = strOf(section, 'id') ?? '';
            const stageKey = strOf(section, 'stage');
            return {
              id,
              title: textOf(section.title, locale) ?? id,
              body: textOf(section.body, locale) ?? '',
              stage: stageKey === null ? null : c.stageName(stageKey),
            };
          }),
      [],
    ),
    coverage,
    coverageLine: describeCoverage(coverage, c.locale),
  };
}

/**
 * The description as plain text: title, summary, overview, then one block per section with a heading from the
 * catalog. Deterministic (no clock, no environment) and in the description's own language.
 */
export function definitionToPlainText(d: DefinitionDescription): string {
  const locale: Locale = d.locale === 'de' ? 'de' : 'en';
  const t = createTranslator(formatStudioDescribeMessages, locale);
  const lines: string[] = [d.title];
  if (d.summary !== null && d.summary !== '') lines.push(d.summary);
  if (d.overview !== '') lines.push('', d.overview);
  if (d.stages.length > 0) {
    lines.push('', t('heading.stages'));
    for (const stage of d.stages) {
      lines.push(`- ${stage.summary}`);
      for (const line of [stage.participants, stage.groups, stage.ruleset, stage.doubles, stage.expected]) {
        if (line !== null && line !== '') lines.push(`  ${line}`);
      }
    }
  }
  if (d.advancement.length > 0) {
    lines.push('', t('heading.advancement'));
    for (const line of d.advancement) lines.push(`- ${line}`);
  }
  if (d.views.length > 0) {
    lines.push('', t('heading.views'));
    for (const line of d.views) lines.push(`- ${line}`);
  }
  if (d.rules.length > 0) {
    lines.push('', t('heading.rules'));
    for (const rule of d.rules) {
      const visible = rule.visibleToPlayers ? t('rule.visible_yes') : t('rule.visible_no');
      lines.push(`- ${[rule.text, rule.verify, rule.when, visible].filter((part) => part !== '').join(' ')}`);
    }
  }
  if (d.modules.length > 0) {
    lines.push('', t('heading.modules'));
    for (const entry of d.modules) {
      lines.push(`- ${entry.label}`, `  ${entry.summary}`);
      for (const fact of entry.facts) lines.push(`  ${fact.label}: ${fact.value}`);
    }
  }
  if (d.sections.length > 0) {
    lines.push('', t('heading.sections'));
    for (const section of d.sections) {
      lines.push(section.title);
      if (section.body !== '') lines.push(section.body);
    }
  }
  if (d.coverageLine !== '') lines.push('', t('heading.coverage'), d.coverageLine);
  return lines.join('\n');
}
