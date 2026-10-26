import 'server-only';
/**
 * The compile of the server: `compileRuleset` (src/lib/ruleset-kit/compile.ts) with the data only the server has. A preset
 * base is resolved through the dex (`resolvePresetRules`, per mod), and the id sets of the document's generation and
 * universe make the `unknown_entry` warning available. The browser runs the same `compileRuleset` with the same data
 * fetched from the server, so the editor and the publish gate cannot disagree about an error.
 *
 * `catalogVersion` is the `PRESET_RULES_VERSION` the resolved rules were computed with; a published version stores it.
 */
import { compileRuleset, type CompileResult } from '@/lib/ruleset-kit/compile';
import type { ResolvedRules, RulesetDocument } from '@/lib/ruleset-kit/types';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import { RULESET_CATEGORIES, type RulesetCategory } from '@/lib/ruleset-kit/types';
import { knownIds, presetKnownIds } from '@/lib/pkmn/known-ids.server';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { RulesetStudioError } from './errors';

export interface ServerCompile {
  result: CompileResult;
  catalogVersion: string;
}

/** Compiles an untrusted document with the dex-backed preset and id sets. */
export function compileDocument(input: unknown): ServerCompile {
  const parsed = validateRulesetDocument(input);
  let preset: PresetRules | null = null;
  let known: Partial<Record<RulesetCategory, ReadonlySet<string>>> | undefined;

  if (parsed.ok) {
    const base = parsed.document.base;
    preset = base.kind === 'preset' ? resolvePresetRules(base.preset) : null;
    if (base.kind === 'preset' && preset !== null) {
      const resolvedPreset = preset;
      known = Object.fromEntries(RULESET_CATEGORIES.map((category) => [category, presetKnownIds(resolvedPreset, category)]));
    } else if (base.kind === 'blank') {
      known = Object.fromEntries(RULESET_CATEGORIES.map((category) => [category, knownIds(category, base.gen, base.universe)]));
    }
  }
  return { result: compileRuleset(input, { preset, known }), catalogVersion: PRESET_RULES_VERSION };
}

/** A document that compiled without an error, with everything a publish stores. */
export interface PublishableCompile {
  document: RulesetDocument;
  resolved: ResolvedRules;
  contentHash: string;
  resolvedHash: string;
  catalogVersion: string;
}

/** The publish gate: compiles `input` and returns what a publish stores, or throws `ruleset_document_invalid` with the error count. */
export function compileForPublish(input: unknown): PublishableCompile {
  const { result, catalogVersion } = compileDocument(input);
  if (!result.ok || result.document === null || result.resolved === null || result.content_hash === null || result.resolved_hash === null) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    throw new RulesetStudioError('ruleset_document_invalid', { count: Math.max(errors, 1) });
  }
  return { document: result.document, resolved: result.resolved, contentHash: result.content_hash, resolvedHash: result.resolved_hash, catalogVersion };
}
