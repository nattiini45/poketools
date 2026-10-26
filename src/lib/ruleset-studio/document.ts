/**
 * New ruleset documents: a blank skeleton, and a document that starts from a catalog preset. Pure and client-safe (the
 * preset id is only named here; the preset's lists are resolved at compile time).
 */
import { ltext, type Locale } from '@/lib/studio-core/ltext';
import { RULESET_SCHEMA_VERSION, type RulesetBase, type RulesetDocument } from '@/lib/ruleset-kit/types';

const EMPTY_CATEGORY = (): RulesetDocument['pokemon'] => ({ ban: [], unban: [], allow: null });

/** The name text of a new document in the author's language. */
function nameText(name: string, base: Locale) {
  return base === 'en' ? ltext('en', name) : ltext('de', undefined, name);
}

/**
 * A document with no changes on top of its base. A preset base is recorded in `based_on` too (the catalog id doubles as the
 * format key of a copy that is later rebased onto a blank start).
 */
export function newRulesetDocument(name: string, baseLocale: Locale, preset?: string): RulesetDocument {
  const base: RulesetBase =
    preset === undefined ? { kind: 'blank', gen: 9, doubles: false, universe: 'standard' } : { kind: 'preset', preset };
  return {
    schema_version: RULESET_SCHEMA_VERSION,
    identity: { name: nameText(name, baseLocale), ...(preset === undefined ? {} : { based_on: preset }) },
    base,
    clauses: { add: [], remove: [] },
    pokemon: EMPTY_CATEGORY(),
    moves: EMPTY_CATEGORY(),
    items: EMPTY_CATEGORY(),
    abilities: EMPTY_CATEGORY(),
    min_shared_type_pct: 0,
    team_constraints: null,
    custom_rules: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A copy of a document with `identity.based_on` set (the identity block is created when the draft lacks one). */
export function withBasedOn(document: Record<string, unknown>, basedOn: string): Record<string, unknown> {
  const copy = structuredClone(document);
  const identity = isRecord(copy.identity) ? copy.identity : {};
  return { ...copy, identity: { ...identity, based_on: basedOn.slice(0, 64) } };
}
