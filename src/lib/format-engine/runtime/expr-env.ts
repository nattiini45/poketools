/**
 * Evaluation contexts for the Phase 3 expressions. The ref names are the ones the compiler type-checks with
 * (`format-kit/engine/runtime-names.ts`): a ref spelled there must be present here with the same type, or the
 * evaluator fails with `expr_unknown_ref` / `expr_ref_type`.
 *
 * - player env: the advancement row fields, `participants`, `player`, `attr.<key>`, `tunable.<key>`, `track.<key>`;
 * - match env: `round`, `won`, `lost`, `forfeit`, `faints_dealt`, `faints_taken`, `player`, `opponent`, `attr.*`, `tunable.*`;
 * - entry env: `id`, `attr.<key>` of the entry attributes, `tunable.*`;
 * - event env: `round`, `tunable.*`.
 *
 * A player attribute resolves to the stored value (`format_player_attrs`), else to its assignment (`random_seeded`
 * from the season seed, or an expression over `player` and `tunable.*`), else to the type's neutral value. Every
 * relation of the format answers `rel(key, a, b)` from the state's links. Pure and client-safe.
 */
import type { EvalContext, ExprValue } from '@/lib/format-kit/expr/ast';
import { evaluate } from '@/lib/format-kit/expr/eval';
import { seededRand } from '@/lib/format-kit/expr/rand';
import { attrExprType, attributeMap, PLAYER_ROW_FIELDS, relationKeys } from '@/lib/format-kit/engine/runtime-names';
import type { AttributeDef, DomainEntry, FormatDefinition } from '@/lib/format-kit/types';
import { own, type AttrValue, type KitRuntimeState, type PlayerRow } from './types';

export interface EnvBase {
  def: FormatDefinition;
  state: KitRuntimeState;
  /** The season seed: server side only. */
  seed: string;
  /** The `rand` scope of the expressions evaluated with the context. */
  scope: string;
}

const NO_COLLECTIONS: EvalContext['collections'] = new Map();

/** The value an attribute has when nothing sets it. */
export function attrNeutral(attr: Pick<AttributeDef, 'type'>): AttrValue {
  return attr.type === 'number' ? 0 : attr.type === 'bool' ? false : '';
}

function fitsAttr(attr: AttributeDef, value: unknown): value is AttrValue {
  switch (attr.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && attr.values?.includes(value) === true;
    case 'text':
      return typeof value === 'string';
  }
}

/** `rel(key, a, b)` for every relation of the format, from the links of the state. */
export function relationFns(def: FormatDefinition, state: KitRuntimeState): ReadonlyMap<string, (a: string, b: string) => boolean> {
  const linked = new Map<string, Set<string>>();
  for (const link of state.links) {
    const set = linked.get(link.relation) ?? new Set<string>();
    set.add(`${link.from}\u0000${link.to}`);
    linked.set(link.relation, set);
  }
  const fns = new Map<string, (a: string, b: string) => boolean>();
  for (const key of relationKeys(def)) {
    const set = linked.get(key);
    fns.set(key, (a, b) => set?.has(`${a}\u0000${b}`) === true);
  }
  return fns;
}

/** `tunable.<key>` for every tunable that an expression may read (a table may not be read). */
export function tunableRefs(def: FormatDefinition, state: KitRuntimeState): Map<string, ExprValue> {
  const refs = new Map<string, ExprValue>();
  for (const tunable of def.tunables ?? []) {
    if (tunable.type === 'table' || refs.has(`tunable.${tunable.key}`)) continue;
    const value = own(state.tunables, tunable.key);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') refs.set(`tunable.${tunable.key}`, value);
  }
  return refs;
}

function assignContext(base: EnvBase, playerId: string): EvalContext {
  const refs = new Map<string, ExprValue>([['player', playerId], ...tunableRefs(base.def, base.state)]);
  return { refs, collections: NO_COLLECTIONS, relations: relationFns(base.def, base.state), seed: base.seed, scope: `attr:${playerId}` };
}

/** The value of a player attribute: stored, else assigned, else the neutral value. */
export function playerAttrValue(base: EnvBase, playerId: string, attr: AttributeDef): AttrValue {
  const stored = own(own(base.state.attrs, playerId), attr.key);
  if (stored !== undefined && fitsAttr(attr, stored)) return stored;
  const assign = attr.assign;
  if (assign?.kind === 'random_seeded') {
    const draw = seededRand(base.seed, `attr:${attr.key}`, playerId);
    if (attr.type === 'enum' && attr.values !== undefined && attr.values.length > 0) {
      return attr.values[Math.min(attr.values.length - 1, Math.floor(draw * attr.values.length))];
    }
    if (attr.type === 'bool') return draw < 0.5;
  } else if (assign?.kind === 'expr') {
    const result = evaluate(assign.expr, assignContext(base, playerId), attrExprType(attr));
    if (result.ok && fitsAttr(attr, result.value)) return result.value;
  }
  return attrNeutral(attr);
}

/** `attr.<key>` of every player attribute that expressions may read (not a multi attribute). */
function playerAttrRefs(base: EnvBase, playerId: string): Map<string, ExprValue> {
  const refs = new Map<string, ExprValue>();
  for (const attr of attributeMap(base.def).values()) {
    if (attr.on === 'player' && attr.multi !== true) refs.set(`attr.${attr.key}`, playerAttrValue(base, playerId, attr));
  }
  return refs;
}

/** The refs every player-bound env shares besides its own fields: `player`, `attr.*`, `tunable.*`. */
function playerBoundRefs(base: EnvBase, playerId: string): Map<string, ExprValue> {
  return new Map<string, ExprValue>([['player', playerId], ...playerAttrRefs(base, playerId), ...tunableRefs(base.def, base.state)]);
}

/** Steps reached on each track of the format by a player (0 before the first). */
function trackRefs(base: EnvBase, playerId: string): Map<string, ExprValue> {
  const refs = new Map<string, ExprValue>();
  const reached = own(base.state.tracks, playerId);
  for (const metric of base.def.metrics ?? []) {
    if (metric.kind === 'track.progression' && !refs.has(`track.${metric.key}`)) refs.set(`track.${metric.key}`, own(reached, metric.key) ?? 0);
  }
  return refs;
}

/**
 * The refs of a player that do not come from the standings row: `player`, `attr.*`, `tunable.*`, `track.*`. These are
 * what a standings metric needs next to the row (`playerRefs` of the stage metrics).
 */
export function playerExtraRefMap(base: EnvBase, playerId: string): Map<string, ExprValue> {
  return new Map<string, ExprValue>([...playerBoundRefs(base, playerId), ...trackRefs(base, playerId)]);
}

/** The player env over a standings row (a missing row field is 0). `participants` is the size of the table. */
export function playerContext(base: EnvBase, playerId: string, row: PlayerRow = {}, participants = 0): EvalContext {
  const refs = new Map<string, ExprValue>(PLAYER_ROW_FIELDS.map((field) => [field, field === 'participants' ? participants : (row as Record<string, number | undefined>)[field] ?? 0]));
  for (const [name, value] of playerExtraRefMap(base, playerId)) refs.set(name, value);
  return { refs, collections: NO_COLLECTIONS, relations: relationFns(base.def, base.state), seed: base.seed, scope: base.scope };
}

export interface MatchFacts {
  round: number;
  won: boolean;
  lost: boolean;
  forfeit: boolean;
  faints_dealt: number;
  faints_taken: number;
  opponent: string;
}

/** The match env of one completed match from `playerId`'s side. */
export function matchContext(base: EnvBase, playerId: string, match: MatchFacts): EvalContext {
  const refs = new Map<string, ExprValue>([
    ['round', match.round],
    ['won', match.won],
    ['lost', match.lost],
    ['forfeit', match.forfeit],
    ['faints_dealt', match.faints_dealt],
    ['faints_taken', match.faints_taken],
    ['opponent', match.opponent],
    ...playerBoundRefs(base, playerId),
  ]);
  return { refs, collections: NO_COLLECTIONS, relations: relationFns(base.def, base.state), seed: base.seed, scope: base.scope };
}

/** The value of an entry attribute as an expression reads it; a missing or mismatching value is the neutral one. */
export function entryAttrValue(attr: AttributeDef, entry: DomainEntry): AttrValue {
  const found = entry.attrs.find((a) => a.key === attr.key)?.value;
  return found !== undefined && !Array.isArray(found) && fitsAttr(attr, found) ? found : attrNeutral(attr);
}

/** The entry env of one domain entry (`ActionStep.where`). */
export function entryContext(base: EnvBase, entry: DomainEntry): EvalContext {
  const refs = new Map<string, ExprValue>([['id', entry.id], ...tunableRefs(base.def, base.state)]);
  for (const attr of attributeMap(base.def).values()) {
    if (attr.on === 'entry' && attr.multi !== true) refs.set(`attr.${attr.key}`, entryAttrValue(attr, entry));
  }
  return { refs, collections: NO_COLLECTIONS, relations: relationFns(base.def, base.state), seed: base.seed, scope: base.scope };
}

/** The event env (`OnEventRule.when`): the round of the event (0 when it has none) and the tunables. */
export function eventContext(base: EnvBase, round: number | undefined): EvalContext {
  const refs = new Map<string, ExprValue>([['round', round ?? 0], ...tunableRefs(base.def, base.state)]);
  return { refs, collections: NO_COLLECTIONS, relations: relationFns(base.def, base.state), seed: base.seed, scope: base.scope };
}
