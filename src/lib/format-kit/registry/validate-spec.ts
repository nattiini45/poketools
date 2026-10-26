/**
 * The Spec interpreter: validates a JSON value against a `Spec` (see `spec.ts`) and builds the
 * normalised value. It is the browser twin of the zod schema in `schema/`; both must give the
 * same issues, defaults and value for the same input (`validate-parity.test.ts`).
 *
 * Also here, because both validators share them:
 * - `precheckInput`: the bounded JSON walk that runs before any structural parsing.
 * - `prepareDocument`: the reserved-section scan and the unknown-rule-kind degrade pass, run on
 *   the plain input before zod / the interpreter.
 *
 * Safety rules the interpreter follows:
 * - Input objects are read with own-property checks only, and the result is a fresh object whose
 *   keys come from the SPEC, never from input keys, so an input `__proto__` cannot reach the output.
 * - Recursion depth is the spec depth (about 12) plus delegated expression slots (iterative);
 *   callers bound the input with `precheckInput` first.
 * - At most `MAX_ISSUES` unknown keys are reported per object, so a 5000-key object stays cheap.
 *
 * Which issues stop a node's own checks (the zod behaviour the interpreter reproduces): `type`,
 * `required` and `enum` abort; `range`, `length`, `pattern`, `unknown_key`, `refine` and `limit` do
 * not. Array lengths are checked even when an element failed (the zod schema builds them that way).
 *
 * Zero zod, no server-only import.
 */
import { inspectJson } from '../json';
import { KIND_PATTERN, hasOwn } from '../keys';
import { validateExprJson } from '../expr/validate-json';
import {
  MAX_ISSUES,
  noParams,
  type IssueParams,
  type SchemaIssue,
  type SchemaIssueCode,
  type SchemaNote,
} from '../issues';
import { escapePointerSegment } from '../patch';
import { JSON_MAX_DEPTH, JSON_MAX_NODES, LTEXT_MAX_CHARS, MAX_BODY_BYTES } from '../limits';
import {
  RESERVED_PAIRING_TAGS,
  RESERVED_RULE_KINDS,
  RESERVED_SECTIONS,
  RESERVED_STAGE_FIELDS,
} from './manifest';
import { patternRegex, type FieldSpec, type JsonDefault, type Spec } from './spec';

// --- Output collector ---------------------------------------------------------------------------

export interface SpecOut {
  issues: SchemaIssue[];
  notes: SchemaNote[];
  /** Count of issues that abort a node's own checks (type, required, enum). */
  aborting: number;
}

export function createSpecOut(): SpecOut {
  return { issues: [], notes: [], aborting: 0 };
}

const ABORTING: ReadonlySet<SchemaIssueCode> = new Set<SchemaIssueCode>(['type', 'required', 'enum']);

function push(out: SpecOut, code: SchemaIssueCode, pointer: string, params: IssueParams = noParams()): void {
  out.issues.push({ code, pointer, params });
  if (ABORTING.has(code)) out.aborting += 1;
}

// --- Small helpers ------------------------------------------------------------------------------

/** A JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** Deep copy of a JSON value; defaults and validated expressions go through it. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) setOwn(out, key, cloneJson(value[key]));
    return out as T;
  }
  return value;
}

const child = (pointer: string, name: string): string => `${pointer}/${escapePointerSegment(name)}`;

interface ObjInfo {
  names: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
}
const OBJ_INFO = new WeakMap<object, ObjInfo>();
function objInfo(spec: Extract<Spec, { t: 'obj' }>): ObjInfo {
  let info = OBJ_INFO.get(spec);
  if (!info) {
    info = { names: new Set(spec.fields.map((f) => f.name)), reserved: new Set(spec.reserved ?? []) };
    OBJ_INFO.set(spec, info);
  }
  return info;
}

const VARIANTS = new WeakMap<object, ReadonlyMap<string, Spec>>();
function variantMap(spec: Extract<Spec, { t: 'union' }>): ReadonlyMap<string, Spec> {
  let map = VARIANTS.get(spec);
  if (!map) {
    map = new Map(spec.variants.map((v) => [v.tag, v.spec]));
    VARIANTS.set(spec, map);
  }
  return map;
}

// --- Leaf validators ----------------------------------------------------------------------------

const LTEXT_BASES: readonly string[] = ['en', 'de'];
const LTEXT_STATUSES: readonly string[] = ['human', 'machine', 'reviewed'];

function validateString(
  spec: Extract<Spec, { t: 'str' }>,
  value: unknown,
  pointer: string,
  out: SpecOut,
): string | undefined {
  if (typeof value !== 'string') {
    push(out, 'type', pointer, { expected: 'string' });
    return undefined;
  }
  let ok = true;
  if (value.length < spec.min || value.length > spec.max) {
    push(out, 'length', pointer);
    ok = false;
  }
  if (spec.pattern !== undefined && !patternRegex(spec.pattern).test(value)) {
    push(out, 'pattern', pointer);
    ok = false;
  }
  return ok ? value : undefined;
}

const LTEXT_VALUE_STR: Extract<Spec, { t: 'str' }> = { t: 'str', min: 1, max: LTEXT_MAX_CHARS, pattern: 'text' };

function validateLTextValue(value: unknown, pointer: string, out: SpecOut): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    push(out, 'type', pointer, { expected: 'object' });
    return undefined;
  }
  const result: Record<string, unknown> = {};
  if (hasOwn(value, 'v')) {
    const v = validateString(LTEXT_VALUE_STR, value.v, child(pointer, 'v'), out);
    if (v !== undefined) result.v = v;
  } else push(out, 'required', child(pointer, 'v'));
  if (hasOwn(value, 's')) {
    if (LTEXT_STATUSES.includes(value.s as string)) result.s = value.s;
    else push(out, 'enum', child(pointer, 's'));
  } else push(out, 'required', child(pointer, 's'));
  reportUnknownKeys(value, ['v', 's'], pointer, out);
  return result;
}

/** `{ en?, de?, base }`; the base language must have a text (a `refine` issue otherwise). */
function validateLText(value: unknown, pointer: string, out: SpecOut): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    push(out, 'type', pointer, { expected: 'object' });
    return undefined;
  }
  const startAborting = out.aborting;
  const result: Record<string, unknown> = {};
  for (const locale of LTEXT_BASES) {
    if (!hasOwn(value, locale)) continue;
    const entry = validateLTextValue(value[locale], child(pointer, locale), out);
    if (entry !== undefined) result[locale] = entry;
  }
  if (hasOwn(value, 'base')) {
    if (LTEXT_BASES.includes(value.base as string)) result.base = value.base;
    else push(out, 'enum', child(pointer, 'base'));
  } else push(out, 'required', child(pointer, 'base'));
  reportUnknownKeys(value, ['en', 'de', 'base'], pointer, out);
  if (out.aborting === startAborting && !hasOwn(value, value.base as string)) {
    push(out, 'refine', pointer, { rule: 'ltext_base_present' });
  }
  return result;
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  names: ReadonlySet<string> | readonly string[],
  pointer: string,
  out: SpecOut,
  reserved?: ReadonlySet<string>,
): void {
  const known = Array.isArray(names) ? new Set<string>(names) : (names as ReadonlySet<string>);
  let reported = 0;
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    if (reserved?.has(key)) {
      push(out, 'not_available_yet', child(pointer, key), { what: key });
      continue;
    }
    if (reported < MAX_ISSUES) push(out, 'unknown_key', child(pointer, key));
    reported += 1;
  }
}

// --- The interpreter ----------------------------------------------------------------------------

/**
 * Validates `value` against `spec`; issues go to `out`, pointers are `pointer` plus the path.
 * Returns the normalised value, or undefined when the value is not acceptable.
 */
export function validateSpec(spec: Spec, value: unknown, pointer: string, out: SpecOut): unknown {
  switch (spec.t) {
    case 'bool':
      if (typeof value !== 'boolean') {
        push(out, 'type', pointer, { expected: 'boolean' });
        return undefined;
      }
      return value;
    case 'int':
    case 'num': {
      if (typeof value !== 'number') {
        push(out, 'type', pointer, { expected: 'number' });
        return undefined;
      }
      if (spec.t === 'int' && !Number.isInteger(value)) {
        push(out, 'type', pointer, { expected: 'integer' });
        return undefined;
      }
      if (value < spec.min || value > spec.max || (spec.t === 'int' && !Number.isSafeInteger(value))) {
        push(out, 'range', pointer);
        return undefined;
      }
      return value;
    }
    case 'str':
      return validateString(spec, value, pointer, out);
    case 'enum':
      if (!spec.values.includes(value as string | number)) {
        push(out, 'enum', pointer);
        return undefined;
      }
      return value;
    case 'ltext':
      return validateLText(value, pointer, out);
    case 'expr': {
      const issues = validateExprJson(value, spec.type);
      for (const issue of issues) push(out, issue.code, pointer + issue.pointer, issue.params);
      return issues.length === 0 ? cloneJson(value) : undefined;
    }
    case 'obj':
      return validateObject(spec, value, pointer, out);
    case 'arr': {
      if (!Array.isArray(value)) {
        push(out, 'type', pointer, { expected: 'array' });
        return undefined;
      }
      const result: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) {
        result.push(validateSpec(spec.item, value[i], `${pointer}/${i}`, out));
      }
      if (value.length < spec.min || value.length > spec.max) push(out, 'length', pointer);
      return result;
    }
    case 'union':
      return validateUnion(spec, value, pointer, out);
    case 'oneof':
      return validateOneOf(spec, value, pointer, out);
  }
}

function validateObject(
  spec: Extract<Spec, { t: 'obj' }>,
  value: unknown,
  pointer: string,
  out: SpecOut,
): unknown {
  if (!isRecord(value)) {
    push(out, 'type', pointer, { expected: 'object' });
    return undefined;
  }
  const info = objInfo(spec);
  const result: Record<string, unknown> = {};
  for (const field of spec.fields) applyField(field, value, pointer, result, out);
  reportUnknownKeys(value, info.names, pointer, out, info.reserved);
  return result;
}

function applyField(
  field: FieldSpec,
  value: Record<string, unknown>,
  pointer: string,
  result: Record<string, unknown>,
  out: SpecOut,
): void {
  if (hasOwn(value, field.name)) {
    const checked = validateSpec(field.spec, value[field.name], child(pointer, field.name), out);
    if (checked !== undefined) result[field.name] = checked;
  } else if (field.default !== undefined) {
    result[field.name] = cloneJson<JsonDefault>(field.default);
  } else if (field.optional !== true) {
    push(out, 'required', child(pointer, field.name));
  }
}

function validateUnion(
  spec: Extract<Spec, { t: 'union' }>,
  value: unknown,
  pointer: string,
  out: SpecOut,
): unknown {
  if (!isRecord(value)) {
    push(out, 'type', pointer, { expected: 'object' });
    return undefined;
  }
  let target: Record<string, unknown> = value;
  if (spec.unknown === 'degrade_rule') {
    const decision = classifyRuleEntry(value, pointer);
    if (decision.action === 'issue') {
      push(out, decision.issue.code, decision.issue.pointer, decision.issue.params);
      return undefined;
    }
    if (decision.action === 'degrade') {
      out.notes.push(decision.note);
      target = decision.node;
    }
  }
  const tag = hasOwn(target, spec.tag) ? target[spec.tag] : undefined;
  if (typeof tag === 'string' && spec.reservedTags?.includes(tag)) {
    push(out, 'not_available_yet', pointer, { what: tag });
    return undefined;
  }
  const variantSpec = typeof tag === 'string' ? variantMap(spec).get(tag) : undefined;
  if (!variantSpec) {
    push(out, tag === undefined ? 'required' : 'enum', child(pointer, spec.tag));
    return undefined;
  }
  return validateSpec(variantSpec, target, pointer, out);
}

/**
 * The first option that accepts the value. When none does: if exactly one option failed only on
 * limits (it recognised the value's type) its issues are reported, otherwise one `type` issue.
 */
function validateOneOf(
  spec: Extract<Spec, { t: 'oneof' }>,
  value: unknown,
  pointer: string,
  out: SpecOut,
): unknown {
  const attempts: SpecOut[] = [];
  for (const option of spec.options) {
    const attempt = createSpecOut();
    const checked = validateSpec(option, value, pointer, attempt);
    if (attempt.issues.length === 0) return checked;
    attempts.push(attempt);
  }
  const recognised = attempts.filter((attempt) => attempt.aborting === 0);
  if (recognised.length === 1) {
    for (const issue of recognised[0].issues) push(out, issue.code, issue.pointer, issue.params);
    return undefined;
  }
  push(out, 'type', pointer, { expected: 'union' });
  return undefined;
}

// --- Shared pre-checks --------------------------------------------------------------------------

/**
 * The bounded JSON walk (depth, node count, bytes, JSON-ness) that runs before any structural
 * parsing. Returns the single issue to report, or null when the input may be parsed.
 */
export function precheckInput(input: unknown): SchemaIssue | null {
  const result = inspectJson(input, { maxDepth: JSON_MAX_DEPTH, maxNodes: JSON_MAX_NODES, maxBytes: MAX_BODY_BYTES });
  if (result.ok) return null;
  const limit = result.reason === 'bytes' ? 'body_bytes' : result.reason;
  return { code: result.reason === 'not_json' ? 'type' : 'limit', pointer: result.pointer, params: { limit } };
}

// --- Rules list: the open kind list ---------------------------------------------------------------

export type RuleDecision =
  | { action: 'keep' }
  | { action: 'issue'; issue: SchemaIssue }
  | { action: 'degrade'; node: Record<string, unknown>; note: SchemaNote };

/** A schema-valid card that stands in for an entry that already has its own issue. */
function placeholderRule(): Record<string, unknown> {
  return { kind: 'rule.custom', id: 'placeholder', text: { base: 'en', en: { v: 'placeholder', s: 'machine' } } };
}

/**
 * Decides what a `rules[]` entry is: a known card (kept), an entry with a kind problem (an issue),
 * or an unknown kind that becomes a manual rule card. A degraded card reads only the entry's `kind`,
 * `id` and `text`; every other key is dropped unread.
 */
export function classifyRuleEntry(entry: unknown, pointer: string): RuleDecision {
  if (!isRecord(entry)) return { action: 'keep' };
  const kindPointer = child(pointer, 'kind');
  if (!hasOwn(entry, 'kind')) {
    return { action: 'issue', issue: { code: 'required', pointer: kindPointer, params: noParams() } };
  }
  const kind = entry.kind;
  if (typeof kind !== 'string') {
    return { action: 'issue', issue: { code: 'type', pointer: kindPointer, params: { expected: 'string' } } };
  }
  if (kind === 'rule.custom') return { action: 'keep' };
  if ((RESERVED_RULE_KINDS as readonly string[]).includes(kind)) {
    return { action: 'issue', issue: { code: 'not_available_yet', pointer, params: { what: kind } } };
  }
  if (!KIND_PATTERN.test(kind)) {
    return { action: 'issue', issue: { code: 'pattern', pointer: kindPointer, params: noParams() } };
  }
  const node: Record<string, unknown> = { kind: 'rule.custom' };
  if (hasOwn(entry, 'id')) node.id = entry.id;
  let text: unknown = { base: 'en', en: { v: kind, s: 'machine' } };
  if (hasOwn(entry, 'text')) {
    const probe = createSpecOut();
    const checked = validateLText(entry.text, '', probe);
    if (probe.issues.length === 0) text = checked;
  }
  node.text = text;
  node.degraded_from = kind;
  return { action: 'degrade', node, note: { code: 'unknown_primitive', pointer, params: { kind } } };
}

// --- Document pre-pass --------------------------------------------------------------------------

export interface PreparedDocument {
  /** The input with reserved subtrees removed and unknown rule kinds degraded (copy on write). */
  doc: unknown;
  /** `not_available_yet` and rule-kind issues; the subtrees they name are not validated further. */
  issues: SchemaIssue[];
  notes: SchemaNote[];
}

/**
 * Runs on the plain input before zod / the interpreter:
 * - a reserved top-level section, stage field, pairing kind or rule kind yields one
 *   `not_available_yet` issue at its pointer and nothing else for that subtree;
 * - a `rules[]` entry with an unknown kind becomes a manual rule card (with a note).
 * The input is never mutated; only the touched spine is copied.
 */
export function prepareDocument(input: unknown): PreparedDocument {
  const issues: SchemaIssue[] = [];
  const notes: SchemaNote[] = [];
  if (!isRecord(input)) return { doc: input, issues, notes };

  let doc: Record<string, unknown> = input;
  const writableDoc = () => {
    if (doc === input) doc = { ...input };
    return doc;
  };

  for (const name of RESERVED_SECTIONS) {
    if (!hasOwn(input, name)) continue;
    issues.push({ code: 'not_available_yet', pointer: child('', name), params: { what: name } });
    delete writableDoc()[name];
  }

  if (Array.isArray(input.stages)) {
    const stages = input.stages as unknown[];
    let nextStages: unknown[] | null = null;
    for (let i = 0; i < stages.length; i += 1) {
      const stage = stages[i];
      if (!isRecord(stage)) continue;
      let nextStage: Record<string, unknown> | null = null;
      const writableStage = () => (nextStage ??= { ...stage });
      for (const field of RESERVED_STAGE_FIELDS) {
        if (!hasOwn(stage, field)) continue;
        issues.push({ code: 'not_available_yet', pointer: `/stages/${i}/${field}`, params: { what: field } });
        delete writableStage()[field];
      }
      const pairing = stage.pairing;
      if (
        isRecord(pairing) &&
        typeof pairing.kind === 'string' &&
        (RESERVED_PAIRING_TAGS as readonly string[]).includes(pairing.kind)
      ) {
        issues.push({
          code: 'not_available_yet',
          pointer: `/stages/${i}/pairing`,
          params: { what: `pairing.${pairing.kind}` },
        });
        writableStage().pairing = { kind: 'manual' };
      }
      if (nextStage) {
        nextStages ??= [...stages];
        nextStages[i] = nextStage;
      }
    }
    if (nextStages) writableDoc().stages = nextStages;
  }

  if (Array.isArray(input.rules)) {
    const rules = input.rules as unknown[];
    let nextRules: unknown[] | null = null;
    for (let i = 0; i < rules.length; i += 1) {
      const decision = classifyRuleEntry(rules[i], `/rules/${i}`);
      if (decision.action === 'keep') continue;
      nextRules ??= [...rules];
      if (decision.action === 'issue') {
        issues.push(decision.issue);
        nextRules[i] = placeholderRule();
      } else {
        notes.push(decision.note);
        nextRules[i] = decision.node;
      }
    }
    if (nextRules) writableDoc().rules = nextRules;
  }

  return { doc, issues, notes };
}
