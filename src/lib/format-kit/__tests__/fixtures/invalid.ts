/**
 * Invalid (and compile-only) variants of the valid fixture documents: one per schema issue code
 * and per limit. The schema tests assert the expected issues; the parity test feeds the same
 * inputs to both validators.
 */
import { cupDoc, kitchenSinkDoc, leagueDoc, lt, minimalDoc, swissDoc, type Json } from './docs';

export type Path = ReadonlyArray<string | number>;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parentOf(doc: unknown, path: Path): Record<string, unknown> {
  let node = doc as Record<string, unknown>;
  for (const step of path.slice(0, -1)) node = node[step as string] as Record<string, unknown>;
  return node;
}

/** Sets `path` to `value` on `doc` (mutates, returns doc). A `__proto__` step creates an own key. */
export function setAt<T>(doc: T, path: Path, value: unknown): T {
  const parent = parentOf(doc, path);
  const last = path[path.length - 1] as string;
  if (last === '__proto__') {
    Object.defineProperty(parent, last, { value, enumerable: true, writable: true, configurable: true });
  } else {
    parent[last] = value;
  }
  return doc;
}

export function deleteAt<T>(doc: T, path: Path): T {
  const parent = parentOf(doc, path);
  delete parent[path[path.length - 1] as string];
  return doc;
}

export function nestedArray(depth: number): unknown {
  let out: unknown = [];
  for (let i = 0; i < depth; i += 1) out = [out];
  return out;
}

export interface ExpectedIssue {
  code: string;
  pointer: string;
}

export interface InvalidCase {
  id: string;
  build: () => unknown;
  /** Every (code, pointer) the result must contain (`*` matches any pointer); with `only`, nothing else may be reported. */
  issues: ExpectedIssue[];
  only?: true;
}

function withStages(count: number): Json {
  const doc = minimalDoc();
  const stage = (doc.stages as Json[])[0];
  doc.stages = Array.from({ length: count }, (_, i) => ({ ...clone(stage), key: `stage_${i}` }));
  return doc;
}

function withRules(count: number): Json {
  const doc = minimalDoc();
  doc.rules = Array.from({ length: count }, (_, i) => ({ kind: 'rule.custom', id: `rule_${i}`, text: lt('Rule') }));
  return doc;
}

const bad = (id: string, build: () => unknown, code: string, pointer: string): InvalidCase => ({
  id,
  build,
  issues: [{ code, pointer }],
  only: true,
});

const S0 = ['stages', 0] as const;

export const INVALID_CASES: readonly InvalidCase[] = [
  bad('unknown top-level key', () => ({ ...minimalDoc(), foo: 1 }), 'unknown_key', '/foo'),
  bad('own __proto__ key', () => setAt(minimalDoc(), ['__proto__'], { polluted: true }), 'unknown_key', '/__proto__'),
  bad('schema_version missing', () => deleteAt(minimalDoc(), ['schema_version']), 'required', '/schema_version'),
  bad('schema_version 2', () => setAt(minimalDoc(), ['schema_version'], 2), 'enum', '/schema_version'),
  bad('schema_version as string', () => setAt(minimalDoc(), ['schema_version'], '1'), 'enum', '/schema_version'),
  bad('no stages', () => setAt(minimalDoc(), ['stages'], []), 'length', '/stages'),
  bad('51 stages', () => withStages(51), 'length', '/stages'),
  bad('201 rules', () => withRules(201), 'length', '/rules'),
  bad('stages is not an array', () => setAt(minimalDoc(), ['stages'], {}), 'type', '/stages'),
  bad('root is an array', () => [], 'type', ''),
  bad('root is null', () => null, 'type', ''),
  bad('root is a string', () => 'text', 'type', ''),
  bad('undefined root', () => undefined, 'type', ''),
  bad('best_of 0', () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], 0), 'range', '/stages/0/series/best_of'),
  bad('best_of 16', () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], 16), 'range', '/stages/0/series/best_of'),
  bad('best_of 2.5', () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], 2.5), 'type', '/stages/0/series/best_of'),
  bad('best_of as string', () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], '3'), 'type', '/stages/0/series/best_of'),
  bad('best_of beyond safe integers', () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], 1e300), 'range', '/stages/0/series/best_of'),
  bad('groups.count 1', () => setAt(cupDoc(), [...S0, 'groups', 'count'], 1), 'range', '/stages/0/groups/count'),
  bad('groups.count 27', () => setAt(cupDoc(), [...S0, 'groups', 'count'], 27), 'range', '/stages/0/groups/count'),
  bad('legs 0', () => setAt(minimalDoc(), [...S0, 'pairing', 'legs'], 0), 'range', '/stages/0/pairing/legs'),
  bad('legs 5', () => setAt(minimalDoc(), [...S0, 'pairing', 'legs'], 5), 'range', '/stages/0/pairing/legs'),
  bad('players_per_match 1', () => setAt(minimalDoc(), [...S0, 'players_per_match'], 1), 'range', '/stages/0/players_per_match'),
  bad('players_per_match 9', () => setAt(minimalDoc(), [...S0, 'players_per_match'], 9), 'range', '/stages/0/players_per_match'),
  bad('select with no entries', () => setAt(cupDoc(), ['edges', 0, 'select'], []), 'length', '/edges/0/select'),
  bad(
    'select with five entries',
    () => setAt(cupDoc(), ['edges', 0, 'select'], Array.from({ length: 5 }, () => ({ kind: 'top_n', n: 1 }))),
    'length',
    '/edges/0/select',
  ),
  bad(
    '13 rank steps',
    () => setAt(minimalDoc(), [...S0, 'rank'], Array.from({ length: 13 }, () => ({ kind: 'coin_flip' }))),
    'length',
    '/stages/0/rank',
  ),
  bad(
    'ltext base de with only en',
    () => setAt(minimalDoc(), ['identity', 'name'], { base: 'de', en: { v: 'Only English', s: 'human' } }),
    'refine',
    '/identity/name',
  ),
  bad('ltext without base', () => setAt(minimalDoc(), ['identity', 'name'], { en: { v: 'x', s: 'human' } }), 'required', '/identity/name/base'),
  bad('ltext empty value', () => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], ''), 'length', '/identity/name/en/v'),
  bad('ltext bad status', () => setAt(minimalDoc(), ['identity', 'name', 'en', 's'], 'draft'), 'enum', '/identity/name/en/s'),
  bad(
    'rule text over 4000 chars',
    () => setAt(minimalDoc(), ['rules'], [{ kind: 'rule.custom', id: 'long', text: lt('x'.repeat(4001)) }]),
    'length',
    '/rules/0/text/en/v',
  ),
  bad('key too long', () => setAt(minimalDoc(), [...S0, 'key'], 'a'.repeat(33)), 'pattern', '/stages/0/key'),
  bad('key uppercase', () => setAt(minimalDoc(), [...S0, 'key'], 'Main'), 'pattern', '/stages/0/key'),
  bad('key empty', () => setAt(minimalDoc(), [...S0, 'key'], ''), 'pattern', '/stages/0/key'),
  bad('unknown stage key', () => setAt(minimalDoc(), [...S0, 'colour'], 'red'), 'unknown_key', '/stages/0/colour'),
  bad('unknown nested key', () => setAt(minimalDoc(), [...S0, 'scoring', 'bonus'], 1), 'unknown_key', '/stages/0/scoring/bonus'),
  bad('unknown ltext key', () => setAt(minimalDoc(), ['identity', 'name', 'fr'], { v: 'x', s: 'human' }), 'unknown_key', '/identity/name/fr'),
  bad('missing pairing', () => deleteAt(minimalDoc(), [...S0, 'pairing']), 'required', '/stages/0/pairing'),
  bad('pairing without kind', () => setAt(minimalDoc(), [...S0, 'pairing'], {}), 'required', '/stages/0/pairing/kind'),
  bad('unknown pairing kind', () => setAt(minimalDoc(), [...S0, 'pairing', 'kind'], 'lottery'), 'enum', '/stages/0/pairing/kind'),
  bad('pairing is a string', () => setAt(minimalDoc(), [...S0, 'pairing'], 'swiss'), 'type', '/stages/0/pairing'),
  bad('swiss rounds 33', () => setAt(swissDoc(), [...S0, 'pairing', 'rounds'], 33), 'range', '/stages/0/pairing/rounds'),
  bad('swiss rounds text', () => setAt(swissDoc(), [...S0, 'pairing', 'rounds'], 'many'), 'type', '/stages/0/pairing/rounds'),
  bad('swiss rounds 2.5', () => setAt(swissDoc(), [...S0, 'pairing', 'rounds'], 2.5), 'type', '/stages/0/pairing/rounds'),
  bad('ruleset id not a uuid', () => setAt(minimalDoc(), [...S0, 'ruleset'], { kind: 'ruleset', id: 'nope' }), 'pattern', '/stages/0/ruleset/id'),
  bad('ruleset kind unknown', () => setAt(minimalDoc(), [...S0, 'ruleset'], { kind: 'custom' }), 'enum', '/stages/0/ruleset/kind'),
  bad('scoring win missing', () => deleteAt(minimalDoc(), [...S0, 'scoring', 'win']), 'required', '/stages/0/scoring/win'),
  bad('scoring beyond 1000', () => setAt(minimalDoc(), [...S0, 'scoring', 'win'], 1001), 'range', '/stages/0/scoring/win'),
  bad('rank direction unknown', () => setAt(leagueDoc(), [...S0, 'rank', 0, 'direction'], 'up'), 'enum', '/stages/0/rank/0/direction'),
  bad('rank metric not a key', () => setAt(leagueDoc(), [...S0, 'rank', 0, 'metric'], 'Points!'), 'pattern', '/stages/0/rank/0/metric'),
  bad('seeding unknown', () => setAt(minimalDoc(), [...S0, 'participants', 'seeding'], 'alphabetical'), 'enum', '/stages/0/participants/seeding'),
  bad('expected_count 1', () => setAt(leagueDoc(), [...S0, 'participants', 'expected_count'], 1), 'range', '/stages/0/participants/expected_count'),
  bad('top_n 0', () => setAt(cupDoc(), ['edges', 0, 'select'], [{ kind: 'top_n', n: 0 }]), 'range', '/edges/0/select/0/n'),
  bad('per_group 65', () => setAt(cupDoc(), ['edges', 0, 'select', 0, 'n'], 65), 'range', '/edges/0/select/0/n'),
  bad('select kind unknown', () => setAt(cupDoc(), ['edges', 0, 'select', 0, 'kind'], 'random_n'), 'enum', '/edges/0/select/0/kind'),
  bad('threshold without when', () => setAt(cupDoc(), ['edges', 0, 'select'], [{ kind: 'threshold' }]), 'required', '/edges/0/select/0/when'),
  bad('threshold with a non-object when', () => setAt(cupDoc(), ['edges', 0, 'select'], [{ kind: 'threshold', when: 5 }]), 'type', '/edges/0/select/0/when'),
  bad(
    'threshold with an unknown expression kind',
    () => setAt(cupDoc(), ['edges', 0, 'select'], [{ kind: 'threshold', when: { k: 'bogus' } }]),
    'enum',
    '/edges/0/select/0/when/k',
  ),
  bad('edge without from', () => deleteAt(cupDoc(), ['edges', 0, 'from']), 'required', '/edges/0/from'),
  bad('edge gate unknown', () => setAt(cupDoc(), ['edges', 0, 'gate'], 'maybe'), 'enum', '/edges/0/gate'),
  bad('view with one stage', () => setAt(kitchenSinkDoc(), ['views', 0, 'stages'], ['groups']), 'length', '/views/0/stages'),
  bad('view combine unknown', () => setAt(kitchenSinkDoc(), ['views', 0, 'combine'], 'avg'), 'enum', '/views/0/combine'),
  bad('rule scope unknown', () => setAt(kitchenSinkDoc(), ['rules', 0, 'scope', 'kind'], 'league'), 'enum', '/rules/0/scope/kind'),
  bad('rule scope stage without stage', () => deleteAt(kitchenSinkDoc(), ['rules', 0, 'scope', 'stage']), 'required', '/rules/0/scope/stage'),
  bad('rule verify unknown', () => setAt(kitchenSinkDoc(), ['rules', 0, 'verify'], 'trust'), 'enum', '/rules/0/verify'),
  bad('rule visible_to_players as text', () => setAt(kitchenSinkDoc(), ['rules', 0, 'visible_to_players'], 'no'), 'type', '/rules/0/visible_to_players'),
  bad('theme world not a key', () => setAt(kitchenSinkDoc(), ['theme', 'world'], 'Dark Forest'), 'pattern', '/theme/world'),
  bad('module adapter unknown', () => setAt(kitchenSinkDoc(), ['modules', 0, 'adapter'], 'other'), 'enum', '/modules/0/adapter'),
  bad(
    'four modules',
    () => setAt(minimalDoc(), ['modules'], Array.from({ length: 4 }, () => ({ kind: 'module.legacy', adapter: 'epb' }))),
    'length',
    '/modules',
  ),
  bad('fact value null', () => setAt(kitchenSinkDoc(), ['modules', 0, 'facts', 0, 'value'], null), 'type', '/modules/0/facts/0/value'),
  bad('fact value too long', () => setAt(kitchenSinkDoc(), ['modules', 0, 'facts', 1, 'value'], 'x'.repeat(4001)), 'length', '/modules/0/facts/1/value'),
  bad('text section stage not a key', () => setAt(kitchenSinkDoc(), ['text', 'sections', 0, 'stage'], 'Intro Stage'), 'pattern', '/text/sections/0/stage'),
  bad('based_on not a slug', () => setAt(leagueDoc(), ['identity', 'based_on'], 'Not A Slug'), 'pattern', '/identity/based_on'),
  bad('null stage', () => setAt(minimalDoc(), ['stages'], [null]), 'type', '/stages/0'),
  bad('reserved attributes section', () => ({ ...minimalDoc(), attributes: {} }), 'not_available_yet', '/attributes'),
  bad('reserved tunables section', () => ({ ...minimalDoc(), tunables: [1, 2, 3] }), 'not_available_yet', '/tunables'),
  bad('reserved stage field', () => setAt(minimalDoc(), [...S0, 'end_when'], { whatever: true }), 'not_available_yet', '/stages/0/end_when'),
  bad('reserved pairing kind', () => setAt(minimalDoc(), [...S0, 'pairing'], { kind: 'bipartite', anything: 1 }), 'not_available_yet', '/stages/0/pairing'),
  bad('reserved rule kind', () => setAt(minimalDoc(), ['rules'], [{ kind: 'rule.on_event', junk: 1 }]), 'not_available_yet', '/rules/0'),
  bad('rule without kind', () => setAt(minimalDoc(), ['rules'], [{ id: 'x' }]), 'required', '/rules/0/kind'),
  bad('rule kind as number', () => setAt(minimalDoc(), ['rules'], [{ kind: 5 }]), 'type', '/rules/0/kind'),
  bad('rule kind with a bad shape', () => setAt(minimalDoc(), ['rules'], [{ kind: 'Bad Kind!' }]), 'pattern', '/rules/0/kind'),
  bad('degraded rule without id', () => setAt(minimalDoc(), ['rules'], [{ kind: 'rule.future' }]), 'required', '/rules/0/id'),
  bad('degraded rule with a bad id', () => setAt(minimalDoc(), ['rules'], [{ kind: 'rule.future', id: 'Bad Id' }]), 'pattern', '/rules/0/id'),
  bad('rule is a string', () => setAt(minimalDoc(), ['rules'], ['rule.custom']), 'type', '/rules/0'),
  bad('body over 256 KB', () => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], 'x'.repeat(300_000)), 'limit', '*'),
  { id: 'nested deeper than 64', build: () => setAt(minimalDoc(), ['theme'], nestedArray(70)), issues: [{ code: 'limit', pointer: '*' }] },
  { id: 'NUL in a string', build: () => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], 'a\u0000b'), issues: [{ code: 'type', pointer: '*' }] },
  { id: 'NaN number', build: () => setAt(minimalDoc(), [...S0, 'scoring', 'win'], Number.NaN), issues: [{ code: 'type', pointer: '*' }] },
];

/** Documents that must stay valid even though a later phase (the compiler) objects. */
export const COMPILE_ONLY_CASES: ReadonlyArray<{ id: string; build: () => Json }> = [
  { id: 'even best_of', build: () => setAt(minimalDoc(), [...S0, 'series', 'best_of'], 2) },
  { id: 'even override best_of', build: () => setAt(leagueDoc(), ['stages', 1, 'series', 'overrides', 0, 'best_of'], 4) },
  {
    id: 'draw and forfeit scores',
    build: () => setAt(setAt(minimalDoc(), [...S0, 'scoring', 'draw'], 1), [...S0, 'scoring', 'forfeit'], -3),
  },
  { id: 'allow_draw', build: () => setAt(minimalDoc(), [...S0, 'series', 'allow_draw'], true) },
  { id: 'edge to a missing stage', build: () => setAt(cupDoc(), ['edges', 0, 'to'], 'nowhere') },
  { id: 'duplicate stage keys', build: () => setAt(leagueDoc(), ['stages', 1, 'key'], 'league') },
  { id: 'unknown rank metric', build: () => setAt(leagueDoc(), [...S0, 'rank', 0, 'metric'], 'charisma') },
  { id: 'players_per_match 8', build: () => setAt(minimalDoc(), [...S0, 'players_per_match'], 8) },
  { id: 'keys named like Object.prototype members', build: () => setAt(minimalDoc(), [...S0, 'key'], 'constructor') },
];
