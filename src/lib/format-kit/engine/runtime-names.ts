/**
 * The names the Phase 3 expressions may read, per environment. The compiler type-checks with these tables and the
 * runtime evaluates with the same names, so a ref is spelled one way everywhere:
 *
 * - player env: the advancement row (`points`, `wins`, ..., `participants`), `player` (the id), `attr.<key>` for
 *   every player attribute that is not multi, `tunable.<key>` (a table is not referencable) and `track.<key>`
 *   (the number of steps reached);
 * - match env: `round`, `won`, `lost`, `forfeit`, `faints_dealt`, `faints_taken`, `player`, `opponent`, plus the
 *   player's `attr.*` and `tunable.*`;
 * - entry env: `id` and `attr.<key>` of every entry attribute that is not multi, plus `tunable.*`;
 * - event env: `round` (0 when the event has none) and `tunable.*`;
 * - assignment env: `player` and `tunable.*` only, so attribute assignments cannot depend on each other;
 * - pair env (the `allow` of a filtered pairing): `a` and `b` (the two player ids), `round`, `a_attr.<key>` and
 *   `b_attr.<key>` for every player attribute that is not multi, and `tunable.*`;
 * - team env (the `when` of a team constraint): `round`, `player`, `unlocked.<domain>` (whether the domain is
 *   unlocked), `attr.<key>` of every player attribute that is not multi, and `tunable.*`;
 * - stage env (the `when` of `end_when`): `round` (the last completed round), `rounds_played`, `open_matches`,
 *   `participants` and `tunable.*`.
 *
 * Every relation key is usable in `rel(key, a, b)` in every env. Keys are looked up through Maps (first wins).
 */
import { toMap } from '@/lib/studio-core/keys';
import type { ExprType, TypeEnv } from '../expr/ast';
import type { AttributeDef, FormatDefinition } from '../types';

/** The metrics the standings engine produces itself; a custom metric may not reuse one of these keys. */
export const BUILTIN_METRICS: ReadonlySet<string> = new Set([
  'points',
  'wins',
  'losses',
  'games_played',
  'kill_differential',
  'buchholz',
  'seed',
  'rating',
  'faints_dealt',
  'faints_taken',
]);

/** The advancement-row fields (plus `participants`) a player expression reads as plain numbers. */
export const PLAYER_ROW_FIELDS: readonly string[] = [
  'points',
  'wins',
  'losses',
  'games_played',
  'rank',
  'group_rank',
  'faints_dealt',
  'faints_taken',
  'kill_differential',
  'buchholz',
  'participants',
];

/** The expression type of an attribute's value (an enum value is a key, so text). */
export function attrExprType(attr: AttributeDef): ExprType {
  switch (attr.type) {
    case 'number':
      return 'number';
    case 'bool':
      return 'boolean';
    default:
      return 'text';
  }
}

/** Attributes by key, first declaration wins. */
export function attributeMap(def: FormatDefinition): Map<string, AttributeDef> {
  return toMap(def.attributes ?? [], (a) => a.key);
}

/** Keys of the metrics a rank step, a column or a view may name besides the builtin ones. */
export function customMetricKeys(def: FormatDefinition): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const metric of def.metrics ?? []) {
    if ((metric.kind === 'metric.define' && metric.of === 'player') || metric.kind === 'score.placement') keys.add(metric.key);
  }
  return keys;
}

export function relationKeys(def: FormatDefinition): ReadonlySet<string> {
  return new Set((def.relations ?? []).map((relation) => relation.key));
}

function attrRefs(def: FormatDefinition, on: AttributeDef['on']): Map<string, ExprType> {
  const refs = new Map<string, ExprType>();
  for (const attr of attributeMap(def).values()) {
    if (attr.on === on && attr.multi !== true) refs.set(`attr.${attr.key}`, attrExprType(attr));
  }
  return refs;
}

function tunableRefs(def: FormatDefinition): Map<string, ExprType> {
  const refs = new Map<string, ExprType>();
  for (const tunable of toMap(def.tunables ?? [], (t) => t.key).values()) {
    if (tunable.type === 'table') continue;
    refs.set(`tunable.${tunable.key}`, tunable.type === 'number' ? 'number' : tunable.type === 'bool' ? 'boolean' : 'text');
  }
  return refs;
}

function trackRefs(def: FormatDefinition): Map<string, ExprType> {
  const refs = new Map<string, ExprType>();
  for (const metric of def.metrics ?? []) {
    if (metric.kind === 'track.progression' && !refs.has(`track.${metric.key}`)) refs.set(`track.${metric.key}`, 'number');
  }
  return refs;
}

function envOf(def: FormatDefinition, ...tables: ReadonlyMap<string, ExprType>[]): TypeEnv {
  const refs = new Map<string, ExprType>();
  for (const table of tables) for (const [name, type] of table) refs.set(name, type);
  return { refs, collections: new Map(), relations: relationKeys(def) };
}

const typed = (type: ExprType, ...names: string[]): Map<string, ExprType> => new Map(names.map((name) => [name, type]));

/** The extra refs a standings expression (an edge threshold) reads beyond the advancement row. */
export function playerExtraRefs(def: FormatDefinition): Map<string, ExprType> {
  return new Map<string, ExprType>([
    ['player', 'text'],
    ...attrRefs(def, 'player'),
    ...tunableRefs(def),
    ...trackRefs(def),
  ]);
}

export function playerEnv(def: FormatDefinition): TypeEnv {
  return envOf(def, typed('number', ...PLAYER_ROW_FIELDS), playerExtraRefs(def));
}

export function matchEnv(def: FormatDefinition): TypeEnv {
  return envOf(
    def,
    typed('number', 'round', 'faints_dealt', 'faints_taken'),
    typed('boolean', 'won', 'lost', 'forfeit'),
    typed('text', 'player', 'opponent'),
    attrRefs(def, 'player'),
    tunableRefs(def),
  );
}

export function entryEnv(def: FormatDefinition): TypeEnv {
  return envOf(def, typed('text', 'id'), attrRefs(def, 'entry'), tunableRefs(def));
}

export function eventEnv(def: FormatDefinition): TypeEnv {
  return envOf(def, typed('number', 'round'), tunableRefs(def));
}

export function assignEnv(def: FormatDefinition): TypeEnv {
  return envOf(def, typed('text', 'player'), tunableRefs(def));
}

export function pairEnv(def: FormatDefinition): TypeEnv {
  const sides = new Map<string, ExprType>();
  for (const [name, type] of attrRefs(def, 'player')) {
    const key = name.slice('attr.'.length);
    sides.set(`a_attr.${key}`, type);
    sides.set(`b_attr.${key}`, type);
  }
  return envOf(def, typed('text', 'a', 'b'), typed('number', 'round'), sides, tunableRefs(def));
}

export function teamEnv(def: FormatDefinition): TypeEnv {
  const unlocked = new Map<string, ExprType>();
  for (const domain of toMap(def.domains ?? [], (d) => d.key).values()) unlocked.set(`unlocked.${domain.key}`, 'boolean');
  return envOf(def, typed('number', 'round'), typed('text', 'player'), unlocked, attrRefs(def, 'player'), tunableRefs(def));
}

export function stageEnv(def: FormatDefinition): TypeEnv {
  return envOf(def, typed('number', 'round', 'rounds_played', 'open_matches', 'participants'), tunableRefs(def));
}