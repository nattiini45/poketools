/**
 * The ONE structural validator of a ruleset document: `unknown` in, a normalized `RulesetDocument` or a list of issues
 * out. It runs unchanged in the browser (editor) and on the server (every route, before any database call), so the two
 * can never disagree about what a document is. Hand-written on purpose: the document is flat and small, so the format
 * kit's zod-plus-browser-validator parity machinery is not copied; zod only wraps the API envelopes
 * (`src/lib/ruleset-studio/api-schemas.ts`).
 *
 * Safety: every read is an own-property read (`__proto__`, `constructor` and inherited members are never consulted),
 * the keys of the result are taken from this file and never from the input, strings are checked for NUL (Postgres jsonb
 * refuses it) and every list is length-bounded BEFORE it is copied. Semantic checks (a ban that is also an unban, an id
 * the dex does not know) belong to `compile` (./compile.ts); this file only decides whether the shape is a document.
 *
 * The result is a copy: the input is never mutated and shares no array with the output.
 */
import { SINGLES_TIER_ORDER } from '@/lib/pkmn/tier-constants';
import { hasOwn } from '@/lib/studio-core/keys';
import type { LText } from '@/lib/studio-core/ltext';
import type { TeamConstraints, TierKey } from '@/types/ruleset';
import {
  MAX_BASED_ON_CHARS,
  MAX_CLAUSE_IDS,
  MAX_CUSTOM_RULES_CHARS,
  MAX_ID_LENGTH,
  MAX_IDS_PER_LIST,
  MAX_NAME_CHARS,
} from './limits';
import {
  RULESET_CATEGORIES,
  RULESET_SCHEMA_VERSION,
  RULESET_UNIVERSES,
  type CategoryRules,
  type RulesetBase,
  type RulesetCategory,
  type RulesetDocument,
  type RulesetIdentity,
  type RulesetUniverse,
} from './types';

export type StructureIssueCode =
  | 'not_object'
  | 'unknown_key'
  | 'bad_schema_version'
  | 'bad_text'
  | 'bad_based_on'
  | 'bad_base'
  | 'bad_list'
  | 'list_too_long'
  | 'bad_id'
  | 'bad_percent'
  | 'bad_team_constraints'
  | 'bad_custom_rules';

export interface StructureIssue {
  code: StructureIssueCode;
  /** RFC 6901 JSON pointer into the document. */
  path: string;
}

export type ValidateResult = { ok: true; document: RulesetDocument } | { ok: false; issues: StructureIssue[] };

const ID_PATTERN = /^[a-z0-9]+$/;
const PRESET_PATTERN = /^[a-z][a-z0-9]{0,63}$/;
const TOP_KEYS = [
  'schema_version',
  'identity',
  'base',
  'clauses',
  'pokemon',
  'moves',
  'items',
  'abilities',
  'min_shared_type_pct',
  'team_constraints',
  'custom_rules',
] as const;
const TIER_KEYS: ReadonlySet<string> = new Set(SINGLES_TIER_ORDER);
const LTEXT_MAX = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
  return hasOwn(record, key) ? record[key] : undefined;
}

function hasNul(text: string): boolean {
  return text.includes('\u0000');
}

/** Keys of `record` that are not in `allowed` (own enumerable keys only). */
function unknownKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

/** The one issue of a document that is no object at all. */
function rootNotObject(): StructureIssue[] {
  const out = new Collector();
  out.add('not_object', '');
  return out.issues;
}

class Collector {
  readonly issues: StructureIssue[] = [];
  add(code: StructureIssueCode, path: string): void {
    this.issues.push({ code, path });
  }
}

function parseText(value: unknown, path: string, max: number, out: Collector): LText | null {
  if (!isRecord(value)) {
    out.add('bad_text', path);
    return null;
  }
  const base = own(value, 'base');
  if (base !== 'en' && base !== 'de') {
    out.add('bad_text', `${path}/base`);
    return null;
  }
  const text: LText = { base };
  let ok = true;
  for (const locale of ['en', 'de'] as const) {
    const entry = own(value, locale);
    if (entry === undefined) continue;
    const v = isRecord(entry) ? own(entry, 'v') : undefined;
    const s = isRecord(entry) ? own(entry, 's') : undefined;
    if (!isRecord(entry) || typeof v !== 'string' || v.trim() === '' || v.length > max || hasNul(v)) {
      out.add('bad_text', `${path}/${locale}`);
      ok = false;
      continue;
    }
    if (s !== undefined && s !== 'human' && s !== 'machine' && s !== 'reviewed') {
      out.add('bad_text', `${path}/${locale}/s`);
      ok = false;
      continue;
    }
    text[locale] = { v, s: s === 'machine' || s === 'reviewed' ? s : 'human' };
  }
  if (ok && text[base] === undefined) {
    out.add('bad_text', `${path}/${base}`);
    return null;
  }
  return ok ? text : null;
}

function parseIdList(value: unknown, path: string, max: number, out: Collector): string[] | null {
  if (!Array.isArray(value)) {
    out.add('bad_list', path);
    return null;
  }
  if (value.length > max) {
    out.add('list_too_long', path);
    return null;
  }
  const ids: string[] = [];
  let ok = true;
  for (let i = 0; i < value.length; i++) {
    const id: unknown = value[i];
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) {
      out.add('bad_id', `${path}/${i}`);
      ok = false;
    } else {
      ids.push(id);
    }
  }
  return ok ? ids : null;
}

function parseIdentity(value: unknown, out: Collector): RulesetIdentity | null {
  if (!isRecord(value)) {
    out.add('not_object', '/identity');
    return null;
  }
  for (const key of unknownKeys(value, ['name', 'summary', 'based_on'])) out.add('unknown_key', `/identity/${key}`);
  const name = parseText(own(value, 'name'), '/identity/name', MAX_NAME_CHARS, out);
  const summaryRaw = own(value, 'summary');
  const summary = summaryRaw === undefined ? undefined : parseText(summaryRaw, '/identity/summary', LTEXT_MAX, out);
  const basedOnRaw = own(value, 'based_on');
  let basedOn: string | undefined;
  if (basedOnRaw !== undefined) {
    if (typeof basedOnRaw !== 'string' || basedOnRaw === '' || basedOnRaw.length > MAX_BASED_ON_CHARS || hasNul(basedOnRaw)) {
      out.add('bad_based_on', '/identity/based_on');
    } else {
      basedOn = basedOnRaw;
    }
  }
  if (name === null || summary === null) return null;
  const identity: RulesetIdentity = { name };
  if (summary !== undefined) identity.summary = summary;
  if (basedOn !== undefined) identity.based_on = basedOn;
  return identity;
}

function parseBase(value: unknown, out: Collector): RulesetBase | null {
  if (!isRecord(value)) {
    out.add('not_object', '/base');
    return null;
  }
  const kind = own(value, 'kind');
  if (kind === 'preset') {
    for (const key of unknownKeys(value, ['kind', 'preset'])) out.add('unknown_key', `/base/${key}`);
    const preset = own(value, 'preset');
    if (typeof preset !== 'string' || !PRESET_PATTERN.test(preset)) {
      out.add('bad_base', '/base/preset');
      return null;
    }
    return { kind: 'preset', preset };
  }
  if (kind === 'blank') {
    for (const key of unknownKeys(value, ['kind', 'gen', 'doubles', 'universe'])) out.add('unknown_key', `/base/${key}`);
    const gen = own(value, 'gen');
    const doubles = own(value, 'doubles');
    const universe = own(value, 'universe');
    let ok = true;
    if (typeof gen !== 'number' || !Number.isInteger(gen) || gen < 1 || gen > 9) {
      out.add('bad_base', '/base/gen');
      ok = false;
    }
    if (typeof doubles !== 'boolean') {
      out.add('bad_base', '/base/doubles');
      ok = false;
    }
    if (typeof universe !== 'string' || !(RULESET_UNIVERSES as readonly string[]).includes(universe)) {
      out.add('bad_base', '/base/universe');
      ok = false;
    }
    return ok ? { kind: 'blank', gen: gen as number, doubles: doubles as boolean, universe: universe as RulesetUniverse } : null;
  }
  out.add('bad_base', '/base/kind');
  return null;
}

function parseCategory(value: unknown, path: string, out: Collector): CategoryRules | null {
  if (!isRecord(value)) {
    out.add('not_object', path);
    return null;
  }
  for (const key of unknownKeys(value, ['ban', 'unban', 'allow'])) out.add('unknown_key', `${path}/${key}`);
  const ban = parseIdList(own(value, 'ban'), `${path}/ban`, MAX_IDS_PER_LIST, out);
  const unban = parseIdList(own(value, 'unban'), `${path}/unban`, MAX_IDS_PER_LIST, out);
  const allowRaw = own(value, 'allow');
  const allow = allowRaw === null ? null : parseIdList(allowRaw, `${path}/allow`, MAX_IDS_PER_LIST, out);
  if (ban === null || unban === null || (allowRaw !== null && allow === null)) return null;
  return { ban, unban, allow };
}

function intInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** `null`: no constraints; `undefined`: invalid (an issue was recorded). */
function parseTeamConstraints(value: unknown, out: Collector): TeamConstraints | null | undefined {
  if (value === null) return null;
  const path = '/team_constraints';
  if (!isRecord(value)) {
    out.add('bad_team_constraints', path);
    return undefined;
  }
  const result: TeamConstraints = {};
  let ok = true;
  const fail = (sub: string): void => {
    out.add('bad_team_constraints', `${path}/${sub}`);
    ok = false;
  };
  for (const key of unknownKeys(value, ['type_quotas', 'tera_match', 'evolution_stage', 'eviolite_tier_cap'])) fail(key);

  const quotas = own(value, 'type_quotas');
  if (quotas !== undefined) {
    if (!isRecord(quotas)) {
      fail('type_quotas');
    } else {
      const source = own(quotas, 'source');
      const fixed = own(quotas, 'fixed_types');
      const min = own(quotas, 'min_per_type');
      const multi = own(quotas, 'allow_multi_count');
      const fixedOk =
        fixed === undefined ||
        (Array.isArray(fixed) && fixed.length <= 18 && fixed.every((t) => typeof t === 'string' && t.length <= 20 && !hasNul(t)));
      if ((source !== 'player_core' && source !== 'fixed') || !fixedOk || !intInRange(min, 0, 6) || typeof multi !== 'boolean') {
        fail('type_quotas');
      } else {
        result.type_quotas = {
          source,
          ...(fixed === undefined ? {} : { fixed_types: [...(fixed as string[])] }),
          min_per_type: min,
          allow_multi_count: multi,
        };
      }
    }
  }
  const tera = own(value, 'tera_match');
  if (tera !== undefined) {
    if (tera === 'player_core' || tera === 'team_types' || tera === 'none') result.tera_match = tera;
    else fail('tera_match');
  }
  const stage = own(value, 'evolution_stage');
  if (stage !== undefined) {
    if (!isRecord(stage)) {
      fail('evolution_stage');
    } else {
      const mode = own(stage, 'mode');
      const cap = own(stage, 'fully_evolved_cap');
      const tierMax = own(stage, 'fully_evolved_tier_max');
      const legendaries = own(stage, 'legendaries_allowed');
      const bad =
        (mode !== 'unrestricted' && mode !== 'nfe_only_plus_n_fe') ||
        (cap !== undefined && !intInRange(cap, 0, 6)) ||
        (tierMax !== undefined && (typeof tierMax !== 'string' || !TIER_KEYS.has(tierMax))) ||
        (legendaries !== undefined && typeof legendaries !== 'boolean');
      if (bad) {
        fail('evolution_stage');
      } else {
        result.evolution_stage = {
          mode: mode as 'unrestricted' | 'nfe_only_plus_n_fe',
          ...(cap === undefined ? {} : { fully_evolved_cap: cap as number }),
          ...(tierMax === undefined ? {} : { fully_evolved_tier_max: tierMax as TierKey }),
          ...(legendaries === undefined ? {} : { legendaries_allowed: legendaries as boolean }),
        };
      }
    }
  }
  const eviolite = own(value, 'eviolite_tier_cap');
  if (eviolite !== undefined) {
    if (typeof eviolite === 'string' && TIER_KEYS.has(eviolite)) result.eviolite_tier_cap = eviolite as TierKey;
    else fail('eviolite_tier_cap');
  }
  return ok ? result : undefined;
}

/** Validates the SHAPE of a ruleset document and returns a normalized copy, or every structural issue found. */
export function validateRulesetDocument(input: unknown): ValidateResult {
  const out = new Collector();
  if (!isRecord(input)) return { ok: false, issues: rootNotObject() };
  for (const key of unknownKeys(input, TOP_KEYS)) out.add('unknown_key', `/${key}`);

  if (own(input, 'schema_version') !== RULESET_SCHEMA_VERSION) out.add('bad_schema_version', '/schema_version');
  const identity = parseIdentity(own(input, 'identity'), out);
  const base = parseBase(own(input, 'base'), out);

  let clauses: RulesetDocument['clauses'] | null = null;
  const clausesRaw = own(input, 'clauses');
  if (!isRecord(clausesRaw)) {
    out.add('not_object', '/clauses');
  } else {
    for (const key of unknownKeys(clausesRaw, ['add', 'remove'])) out.add('unknown_key', `/clauses/${key}`);
    const add = parseIdList(own(clausesRaw, 'add'), '/clauses/add', MAX_CLAUSE_IDS, out);
    const remove = parseIdList(own(clausesRaw, 'remove'), '/clauses/remove', MAX_CLAUSE_IDS, out);
    if (add !== null && remove !== null) clauses = { add, remove };
  }

  const categories: Partial<Record<RulesetCategory, CategoryRules>> = {};
  for (const category of RULESET_CATEGORIES) {
    const parsed = parseCategory(own(input, category), `/${category}`, out);
    if (parsed !== null) categories[category] = parsed;
  }

  const pct = own(input, 'min_shared_type_pct');
  if (!intInRange(pct, 0, 100)) out.add('bad_percent', '/min_shared_type_pct');
  const constraints = parseTeamConstraints(own(input, 'team_constraints'), out);
  const rules = own(input, 'custom_rules');
  if (typeof rules !== 'string' || rules.length > MAX_CUSTOM_RULES_CHARS || hasNul(rules)) out.add('bad_custom_rules', '/custom_rules');

  if (
    out.issues.length > 0 ||
    identity === null ||
    base === null ||
    clauses === null ||
    categories.pokemon === undefined ||
    categories.moves === undefined ||
    categories.items === undefined ||
    categories.abilities === undefined ||
    constraints === undefined
  ) {
    return { ok: false, issues: out.issues.length > 0 ? out.issues : rootNotObject() };
  }
  return {
    ok: true,
    document: {
      schema_version: RULESET_SCHEMA_VERSION,
      identity,
      base,
      clauses,
      pokemon: categories.pokemon,
      moves: categories.moves,
      items: categories.items,
      abilities: categories.abilities,
      min_shared_type_pct: pct as number,
      team_constraints: constraints,
      custom_rules: rules as string,
    },
  };
}
