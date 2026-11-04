/**
 * `describePrimitive`: one plain-language sentence for a primitive node, in the viewer's language.
 * Zod-free, pure, never throws: a node of the wrong shape, an unknown kind or a reserved kind
 * returns the kind's label (reserved kinds add the availability text).
 *
 * Text comes from the `format-studio/primitives` namespace through `createTranslator`, so nothing
 * here is cached with a locale. Each available kind has one describer that maps the validated node
 * to template parameters (and picks the template when the node has a variant, such as a Swiss
 * system with automatic rounds). Lists (rank chain, selections) are rendered by describing each
 * element as a short `item.*` phrase and joining them with the locale's list formatter.
 */
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import type { ParamValue } from '@/i18n/types';
import { hasOwn, isKey } from '@/lib/studio-core/keys';
import { printExpr } from '../expr/printer';
import type { Expr } from '../expr/ast';
import { resolveLText, type LText } from '@/lib/studio-core/ltext';
import { getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import { kindKey, type AvailableKind, type PrimitiveKind } from './kinds';
import { manifestEntry } from './manifest';

type Rec = Record<string, unknown>;
type Params = Record<string, ParamValue>;

interface Described {
  /** Template key under `describe.`; defaults to the kind's own key. */
  key?: string;
  params: Params;
}

interface Ctx {
  readonly locale: Locale;
  /** The text of an LText node, or null when it has none. */
  text(value: unknown): string | null;
  /** A translated catalog string under `group.key`, or the fallback. */
  word(group: string, key: string, fallback: string, params?: Params): string;
  /** A short phrase joined with the list formatter. */
  list(items: readonly string[]): string;
  /** The description of a child node. */
  child(kind: string, node: unknown): string;
}

type Describer = (node: Rec, ctx: Ctx) => Described | null;

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (node: Rec, name: string): string | null =>
  hasOwn(node, name) && typeof node[name] === 'string' ? (node[name] as string) : null;
const num = (node: Rec, name: string): number | null =>
  hasOwn(node, name) && typeof node[name] === 'number' && Number.isFinite(node[name]) ? (node[name] as number) : null;
const bool = (node: Rec, name: string): boolean | null =>
  hasOwn(node, name) && typeof node[name] === 'boolean' ? (node[name] as boolean) : null;

/** A metric key as a label; an unknown but well-formed key is shown as written. */
function metricLabel(ctx: Ctx, metric: string): string {
  return isKey(metric) ? ctx.word('metric', metric, metric) : metric;
}

function directionLabel(ctx: Ctx, direction: string): string {
  return ctx.word('option', `direction_${direction}`, direction);
}

/** The short phrase of one rank step, or null for a step of the wrong shape. */
function rankItem(step: unknown, ctx: Ctx): string | null {
  if (!isRec(step)) return null;
  const kind = str(step, 'kind');
  switch (kind) {
    case 'metric': {
      const metric = str(step, 'metric');
      const direction = str(step, 'direction');
      if (metric === null || direction === null) return null;
      return ctx.word('item', 'rank_metric', metric, {
        metric: metricLabel(ctx, metric),
        direction: directionLabel(ctx, direction),
      });
    }
    case 'head_to_head': {
      const scope = str(step, 'scope');
      if (scope === null) return null;
      return ctx.word('item', 'rank_head_to_head', scope, { scope: ctx.word('option', `scope_${scope}`, scope) });
    }
    case 'coin_flip':
    case 'decision_match':
    case 'manual':
      return ctx.word('item', `rank_${kind}`, kind);
    default:
      return null;
  }
}

/** The short phrase of one edge selection, or null for a selection of the wrong shape. */
function selectItem(select: unknown, ctx: Ctx): string | null {
  if (!isRec(select)) return null;
  const kind = str(select, 'kind');
  switch (kind) {
    case 'top_n':
    case 'per_group':
    case 'wildcard':
    case 'bottom_n': {
      const n = num(select, 'n');
      return n === null ? null : ctx.word('item', `select_${kind}`, kind, { n });
    }
    case 'threshold':
    case 'manual_list':
      return ctx.word('item', `select_${kind}`, kind);
    default:
      return null;
  }
}

function pairingKind(node: unknown): string | null {
  if (!isRec(node)) return null;
  const tag = str(node, 'kind');
  return tag === null ? null : `pairing.${tag}`;
}

const exprText = (value: unknown): string => (isRec(value) ? printExpr(value as unknown as Expr) : '');

/** The phrase of an event ("round 2 of stage swiss starts"), or null for an event of the wrong shape. */
function eventPhrase(event: unknown, ctx: Ctx): string | null {
  if (!isRec(event)) return null;
  const tag = str(event, 'event');
  if (tag === null) return null;
  switch (tag) {
    case 'stage_start':
    case 'stage_end':
    case 'match_completed': {
      const stage = str(event, 'stage');
      return stage === null
        ? ctx.word('item', `event_${tag}`, tag)
        : ctx.word('item', `event_${tag}_of`, tag, { stage });
    }
    case 'round_start':
    case 'round_end': {
      const stage = str(event, 'stage');
      const round = num(event, 'round');
      const suffix = `${stage === null ? '' : '_stage'}${round === null ? '' : '_round'}`;
      return ctx.word('item', `event_${tag}${suffix}`, tag, { ...(stage === null ? {} : { stage }), ...(round === null ? {} : { round }) });
    }
    case 'action_locked': {
      const action = str(event, 'action');
      return action === null ? null : ctx.word('item', 'event_action_locked', tag, { action });
    }
    case 'time': {
      const mark = str(event, 'mark');
      return mark === null ? null : ctx.word('item', 'event_time', tag, { mark });
    }
    default:
      return null;
  }
}

function targetPhrase(target: unknown, ctx: Ctx): string {
  const rec = isRec(target) ? target : {};
  const where = exprText(rec.where);
  if (where !== '') return ctx.word('item', 'target_where', where, { where });
  return ctx.word('option', `who_${str(rec, 'who') ?? 'all'}`, 'all');
}

/** The short phrase of one effect, or null for an effect of the wrong shape. */
function effectItem(effect: unknown, ctx: Ctx): string | null {
  if (!isRec(effect)) return null;
  const tag = str(effect, 'effect');
  if (tag === null) return null;
  const who = targetPhrase(effect.to, ctx);
  switch (tag) {
    case 'unlock_domain':
    case 'lock_domain': {
      const domain = str(effect, 'domain');
      return domain === null ? null : ctx.word('item', `effect_${tag}`, tag, { domain });
    }
    case 'reveal_relation':
    case 'generate_relation': {
      const relation = str(effect, 'relation');
      return relation === null ? null : ctx.word('item', `effect_${tag}`, tag, { relation });
    }
    case 'grant_resource':
    case 'revoke_resource': {
      const resource = str(effect, 'resource');
      if (resource === null) return null;
      const item = str(effect, 'item');
      const amount = num(effect, 'amount') ?? 1;
      return item === null
        ? ctx.word('item', `effect_${tag}`, tag, { resource, amount, who })
        : ctx.word('item', `effect_${tag}_item`, tag, { resource, item, who });
    }
    case 'adjust_points': {
      const stage = str(effect, 'stage');
      const points = num(effect, 'points');
      return stage === null || points === null ? null : ctx.word('item', 'effect_adjust_points', tag, { stage, points, who });
    }
    case 'set_attr': {
      const attr = str(effect, 'attr');
      const value = effect.value;
      if (attr === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) return null;
      return ctx.word('item', 'effect_set_attr', tag, { attr, value: String(value), who });
    }
    case 'open_action':
    case 'lock_action': {
      const action = str(effect, 'action');
      return action === null ? null : ctx.word('item', `effect_${tag}`, tag, { action });
    }
    case 'notify': {
      const message = ctx.text(effect.message);
      return message === null ? null : ctx.word('item', 'effect_notify', tag, { message, who });
    }
    default:
      return null;
  }
}

function actionStepItem(step: unknown, ctx: Ctx): string | null {
  if (!isRec(step)) return null;
  const resource = str(step, 'resource');
  const domain = str(step, 'domain');
  const count = num(step, 'count');
  if (resource === null || domain === null || count === null) return null;
  return ctx.word('item', 'action_step', '', { resource, domain, count });
}

const d = (kind: AvailableKind, fn: Describer): [AvailableKind, Describer] => [kind, fn];

const DESCRIBERS: ReadonlyMap<AvailableKind, Describer> = new Map<AvailableKind, Describer>([
  d(
    'stage.define',
    (n, c) => {
      const name = c.text(n.name);
      if (name === null) return null;
      const pairing = pairingKind(n.pairing);
      if (pairing === null) return null;
      const params: Params = {
        name,
        pairing: c.child(pairing, n.pairing),
        series: c.child('series.rule', n.series),
        scoring: c.child('score.match', n.scoring),
      };
      const steps = Array.isArray(n.rank) ? n.rank.map((step) => rankItem(step, c)).filter((s): s is string => s !== null) : [];
      if (steps.length === 0) return { params };
      return { key: 'stage_define_ranked', params: { ...params, ranking: c.word('describe', 'rank_chain', '', { steps: c.list(steps) }) } };
    },
  ),
  d(
    'group.form',
    (n, c) => {
      const count = num(n, 'count');
      const method = str(n, 'method');
      if (count === null || method === null) return null;
      return { params: { count, method: c.word('option', `method_${method}`, method) } };
    },
  ),
  d(
    'pairing.round_robin',
    (n): Described | null => {
      const legs = num(n, 'legs');
      return legs === null ? null : { params: { count: legs } };
    },
  ),
  d(
    'pairing.swiss',
    (n): Described | null => {
      if (n.rounds === 'auto') return { key: 'pairing_swiss_auto', params: {} };
      const rounds = num(n, 'rounds');
      return rounds === null ? null : { params: { count: rounds } };
    },
  ),
  d('pairing.single_elim', (n) => ({ key: bool(n, 'third_place') === true ? 'pairing_single_elim_third' : undefined, params: {} })),
  d('pairing.double_elim', (n) => ({ key: bool(n, 'bracket_reset') === true ? 'pairing_double_elim_reset' : undefined, params: {} })),
  d('pairing.manual', () => ({ params: {} })),
  d(
    'series.rule',
    (n): Described | null => {
      const bestOf = num(n, 'best_of');
      if (bestOf === null) return null;
      const overrides = Array.isArray(n.overrides) ? n.overrides.length : 0;
      if (overrides > 0) return { key: 'series_rule_overrides', params: { best_of: bestOf, count: overrides } };
      return { params: { best_of: bestOf } };
    },
  ),
  d(
    'team.ruleset',
    (n): Described | null => {
      const kind = str(n, 'kind');
      if (kind === 'season_default') return { params: {} };
      if (kind === 'ruleset') return { key: 'team_ruleset_custom', params: {} };
      if (kind === 'preset') {
        const preset = str(n, 'preset');
        // An id the catalog does not know (a compile error elsewhere) is shown as written.
        return preset === null ? null : { key: 'team_ruleset_preset', params: { preset: getRulesetPreset(preset)?.name ?? preset } };
      }
      return null;
    },
  ),
  d(
    'score.match',
    (n, c): Described | null => {
      const win = num(n, 'win');
      const loss = num(n, 'loss');
      const bye = num(n, 'bye');
      if (win === null || loss === null || bye === null) return null;
      const extras: string[] = [];
      const perFaint = num(n, 'per_opponent_faint');
      if (perFaint !== null && perFaint !== 0) extras.push(c.word('item', 'score_per_faint', '', { n: perFaint }));
      const forfeit = n.forfeit;
      if (typeof forfeit === 'number' && Number.isFinite(forfeit)) {
        extras.push(c.word('item', 'score_forfeit', '', { win: forfeit, loss }));
      } else if (isRec(forfeit)) {
        const forfeitWin = num(forfeit, 'win');
        const forfeitLoss = num(forfeit, 'loss') ?? 0;
        if (forfeitWin !== null) {
          const key = bool(forfeit, 'faint_bonus') === true ? 'score_forfeit_bonus' : 'score_forfeit';
          extras.push(c.word('item', key, '', { win: forfeitWin, loss: forfeitLoss }));
        }
      }
      const shown = extras.filter((extra) => extra !== '');
      if (shown.length === 0) return { params: { win, loss, bye } };
      return { key: 'score_match_extra', params: { win, loss, bye, extra: c.list(shown) } };
    },
  ),
  d(
    'rank.metric',
    (n, c) => {
      const metric = str(n, 'metric');
      const direction = str(n, 'direction');
      if (metric === null || direction === null) return null;
      return { params: { metric: metricLabel(c, metric), direction: directionLabel(c, direction) } };
    },
  ),
  d(
    'rank.head_to_head',
    (n, c) => {
      const scope = str(n, 'scope');
      return scope === null ? null : { params: { scope: c.word('option', `scope_${scope}`, scope) } };
    },
  ),
  d('rank.coin_flip', () => ({ params: {} })),
  d('rank.decision_match', () => ({ params: {} })),
  d('rank.manual', () => ({ params: {} })),
  d(
    'standings.view',
    (n, c) => {
      const label = c.text(n.label);
      const metric = str(n, 'metric');
      if (label === null || metric === null || !Array.isArray(n.stages)) return null;
      return { params: { label, metric: metricLabel(c, metric), count: n.stages.length } };
    },
  ),
  d(
    'advance.rule',
    (n, c) => {
      const from = str(n, 'from');
      const to = str(n, 'to');
      if (from === null || to === null || !Array.isArray(n.select)) return null;
      const items = n.select.map((select) => selectItem(select, c)).filter((s): s is string => s !== null);
      return { params: { from, to, selects: c.list(items) } };
    },
  ),
  d('advance.top_n', countOf('n')),
  d('advance.per_group', countOf('n')),
  d('advance.wildcard', countOf('n')),
  d(
    'advance.threshold',
    (n) => {
      if (!isRec(n.when)) return null;
      return { params: { condition: printExpr(n.when as unknown as Expr) } };
    },
  ),
  d('advance.bottom_n', countOf('n')),
  d(
    'advance.manual_list',
    (n): Described | null => {
      const count = num(n, 'count');
      return count === null ? { key: 'advance_manual_list_any', params: {} } : { params: { count } };
    },
  ),
  d(
    'rule.custom',
    (n, c) => {
      const text = c.text(n.text);
      return text === null ? null : { params: { text } };
    },
  ),
  d(
    'text.rules',
    (n, c) => {
      const title = c.text(n.title);
      return title === null ? null : { params: { title } };
    },
  ),
  d(
    'theme.hint',
    (n): Described | null => {
      const world = str(n, 'world');
      if (world === null) return null;
      return world === 'auto' ? { params: {} } : { key: 'theme_hint_world', params: { world } };
    },
  ),
  d(
    'module.legacy',
    (n, c) => {
      const adapter = str(n, 'adapter');
      if (adapter === null) return null;
      const count = Array.isArray(n.facts) ? n.facts.length : 0;
      return { params: { adapter: c.word('option', `adapter_${adapter}`, adapter), count } };
    },
  ),
  d(
    'attr.define',
    (n, c): Described | null => {
      const label = c.text(n.label);
      const on = str(n, 'on');
      const type = str(n, 'type');
      if (label === null || on === null || type === null) return null;
      const params: Params = {
        label,
        on: c.word('option', `on_${on}`, on),
        type: c.word('option', `type_${type}`, type),
      };
      const assign = isRec(n.assign) ? str(n.assign, 'kind') : null;
      if (assign === null) return { params };
      return { key: 'attr_define_assigned', params: { ...params, assign: c.word('option', `kind_${assign}`, assign) } };
    },
  ),
  d(
    'attr.assign',
    (n): Described | null => {
      const kind = str(n, 'kind');
      if (kind === 'manual') return { params: {} };
      if (kind === 'random_seeded') return { key: 'attr_assign_random_seeded', params: {} };
      if (kind === 'expr') return { key: 'attr_assign_expr', params: { expr: exprText(n.expr) } };
      return null;
    },
  ),
  d(
    'domain.define',
    (n, c): Described | null => {
      const label = c.text(n.label);
      if (label === null || !Array.isArray(n.entries)) return null;
      return {
        params: {
          label,
          count: n.entries.length,
          initially: c.word('option', `initially_${str(n, 'initially') ?? 'unlocked'}`, 'unlocked'),
          visibility: c.word('option', `visibility_${str(n, 'visibility') ?? 'public'}`, 'public'),
        },
      };
    },
  ),
  d(
    'relation.define',
    (n, c): Described | null => {
      const label = c.text(n.label);
      const shape = str(n, 'shape');
      if (label === null || shape === null) return null;
      const visibility = isRec(n.visibility) ? n.visibility : {};
      const params: Params = {
        label,
        shape: c.word('option', `shape_${shape}`, shape),
        from: c.word('option', `from_${str(visibility, 'from') ?? 'hidden'}`, 'hidden'),
        to: c.word('option', `to_${str(visibility, 'to') ?? 'own'}`, 'own'),
      };
      const reveal = n.reveal_on === undefined ? null : eventPhrase(n.reveal_on, c);
      return reveal === null ? { params } : { key: 'relation_define_reveal', params: { ...params, event: reveal } };
    },
  ),
  d(
    'resource.define',
    (n, c): Described | null => {
      const label = c.text(n.label);
      if (label === null || !isRec(n.holds)) return null;
      const holds = str(n.holds, 'kind');
      const extras: string[] = [];
      const capacity = num(n, 'capacity');
      if (capacity !== null) extras.push(c.word('item', 'resource_capacity', '', { n: capacity }));
      if (str(n, 'visibility') === 'all') extras.push(c.word('item', 'resource_visible_all', ''));
      if (str(n, 'exclusive') === 'global') extras.push(c.word('item', 'resource_exclusive', ''));
      const shown = extras.filter((extra) => extra !== '');
      const params: Params = { label };
      if (shown.length > 0) params.extra = c.list(shown);
      const suffix = shown.length > 0 ? '_extra' : '';
      if (holds === 'domain') {
        const domain = str(n.holds, 'domain');
        return domain === null ? null : { key: `resource_define${suffix}`, params: { ...params, domain } };
      }
      return holds === 'counter' ? { key: `resource_counter${suffix}`, params } : null;
    },
  ),
  d(
    'metric.define',
    (n, c): Described | null => {
      const label = c.text(n.label);
      const of = str(n, 'of');
      if (label === null || of === null) return null;
      return { params: { label, of: c.word('option', `of_${of}`, of), expr: exprText(n.expr) } };
    },
  ),
  d(
    'track.progression',
    (n, c): Described | null => {
      const label = c.text(n.label);
      if (label === null || !Array.isArray(n.steps)) return null;
      const stage = str(n, 'stage');
      const params: Params = { label, count: n.steps.length };
      return stage === null ? { params } : { key: 'track_progression_stage', params: { ...params, stage } };
    },
  ),
  d(
    'score.placement',
    (n, c): Described | null => {
      const label = c.text(n.label);
      const stage = str(n, 'stage');
      if (label === null || stage === null || !Array.isArray(n.points)) return null;
      const points = n.points.filter((p): p is number => typeof p === 'number').map(String);
      return { params: { label, stage, points: c.list(points) } };
    },
  ),
  d(
    'rule.on_event',
    (n, c): Described | null => {
      const event = eventPhrase(n.on, c);
      if (event === null || !Array.isArray(n.effects)) return null;
      const effects = n.effects.map((effect) => effectItem(effect, c)).filter((s): s is string => s !== null);
      const params: Params = { event, effects: c.list(effects) };
      const condition = exprText(n.when);
      return condition === '' ? { params } : { key: 'rule_on_event_when', params: { ...params, condition } };
    },
  ),
  d(
    'effect.apply',
    (n, c): Described | null => {
      const effect = effectItem(n, c);
      return effect === null ? null : { params: { effect } };
    },
  ),
  d(
    'player.action',
    (n, c): Described | null => {
      const label = c.text(n.label);
      if (label === null || !Array.isArray(n.steps)) return null;
      const steps = n.steps.map((step) => actionStepItem(step, c)).filter((s): s is string => s !== null);
      const params: Params = { label, steps: c.list(steps) };
      const via = str(n, 'via');
      return via === null ? { params } : { key: 'player_action_via', params: { ...params, via } };
    },
  ),
  d(
    'check.assisted',
    (n, c): Described | null => {
      const name = c.text(n.label) ?? str(n, 'id');
      if (name === null || !isRec(n.source)) return null;
      const source = str(n.source, 'kind');
      if (source === null) return null;
      if (source === 'expr') {
        const of = str(n.source, 'of');
        if (of === null) return null;
        return { key: 'check_assisted_expr', params: { name, of: c.word('option', `of_${of}`, of), condition: exprText(n.source.when) } };
      }
      return { params: { name, source: c.word('option', `kind_${source}`, source) } };
    },
  ),
  d(
    'adjust.manual',
    (n, c): Described | null => {
      if (!Array.isArray(n.allow)) return null;
      const allow = n.allow.filter((a): a is string => typeof a === 'string').map((a) => c.word('option', `allow_${a}`, a));
      return { params: { allow: c.list(allow) } };
    },
  ),
]);

function countOf(field: string): Describer {
  return (n) => {
    const count = num(n, field);
    return count === null ? null : { params: { count } };
  };
}

function describeWith(kind: string, node: unknown, locale: Locale): string {
  const t = createTranslator(formatStudioPrimitivesMessages, locale);
  const label = t.dynamic(`label.${kindKey(kind)}`, undefined, kind);
  try {
    const entry = manifestEntry(kind);
    if (!entry) return label;
    if (entry.availability === 'reserved') {
      return t('reservedLine', { label, status: t('availability.reserved') });
    }
    const describer = DESCRIBERS.get(kind as AvailableKind);
    if (!describer || !isRec(node)) return label;
    const ctx: Ctx = {
      locale,
      text: (value) => (isRec(value) ? (resolveLText(value as unknown as LText, { viewer: locale })?.value ?? null) : null),
      word: (group, key, fallback, params) =>
        t.has(`${group}.${key}`) ? t.dynamic(`${group}.${key}`, params, fallback) : fallback,
      list: (items) => (items.length === 0 ? '' : createFormatter({ locale, timeZone: 'UTC' }).list(items)),
      child: (childKind, childNode) => describeWith(childKind, childNode, locale),
    };
    const described = describer(node, ctx);
    if (!described) return label;
    return t.dynamic(`describe.${described.key ?? kindKey(kind)}`, described.params, label);
  } catch {
    return label;
  }
}

/**
 * The sentence for a node, in `locale`. The node is expected to be validated, but any value is
 * safe: a wrong shape, an unknown kind or a reserved kind gives the label of the kind.
 */
export function describePrimitive(kind: PrimitiveKind, node: unknown, locale: Locale): string {
  return describeWith(kind, node, locale);
}
