/**
 * The compile pipeline, independent of the validator that feeds it.
 *
 *  1. inspect the input (bounded, iterative) and hash its canonical form;
 *  2. look the result up by `${input hash}|${environment key}`;
 *  3. validate; an invalid document yields schema diagnostics only and nothing else runs;
 *  4. turn validator notes into warnings;
 *  5. structure checks, 6. stage graph, 7. plan, 8. stage checks, 9. edge checks (expression type checks),
 *  10. translation coverage, 11. capabilities;
 *  12. sort the diagnostics, deep-freeze the result and store it.
 *
 * Compile is pure: no clock, no randomness, no I/O. The result carries codes and params only, never localized
 * text, so a cached result is locale-free; `render.ts` produces sentences after the read.
 */
import type { FormatCapabilities } from '@/lib/season/format-capabilities';
import { contentHash, deepFreeze, inspectJson, type InspectResult } from '@/lib/studio-core/json';
import type { SchemaIssueCode, ValidationResult } from '../issues';
import type { FormatDefinition } from '../types';
import { deriveCapabilities } from './capabilities';
import { checkEdges } from './checks-edge';
import { checkStages } from './checks-stage';
import { checkLTextCoverage, checkStructure } from './checks-structure';
import { diag, sortDiagnostics, type Diagnostic, type DiagnosticCode } from './diagnostics';
import { CURRENT_ENV, envKey, type CompileEnv } from './env';
import { buildStageGraph, type StageGraph } from './graph';
import type { LruCache } from './memo';
import { buildPlan, type StagePlan } from './plan';

export interface CompileResult {
  readonly ok: boolean;
  /** Content hash of the PARSED definition (defaults applied); `null` for an invalid document. */
  readonly hash: string | null;
  readonly definition: FormatDefinition | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly capabilities: FormatCapabilities | null;
  readonly graph: StageGraph | null;
  readonly plan: readonly StagePlan[] | null;
}

export type Validator = (input: unknown) => ValidationResult;

const SCHEMA_CODES: Readonly<Record<SchemaIssueCode, DiagnosticCode>> = {
  required: 'schema_required',
  type: 'schema_type',
  enum: 'schema_enum',
  range: 'schema_range',
  length: 'schema_length',
  pattern: 'schema_pattern',
  unknown_key: 'schema_unknown_key',
  not_available_yet: 'schema_not_available_yet',
  limit: 'schema_limit',
  refine: 'schema_refine',
};

function invalid(diagnostics: Diagnostic[]): CompileResult {
  return { ok: false, hash: null, definition: null, diagnostics: sortDiagnostics(diagnostics), capabilities: null, graph: null, plan: null };
}

function inspectionFailure(result: Exclude<InspectResult, { ok: true }>): Diagnostic {
  switch (result.reason) {
    case 'not_json':
      return diag('schema_type', result.pointer, { limit: 'not_json' });
    case 'depth':
      return diag('schema_limit', result.pointer, { limit: 'depth' });
    case 'nodes':
      return diag('schema_limit', result.pointer, { limit: 'nodes' });
    default:
      return diag('schema_limit', result.pointer, { limit: 'body_bytes' });
  }
}

export interface Analysis {
  diagnostics: Diagnostic[];
  graph: StageGraph;
  plan: StagePlan[];
  capabilities: FormatCapabilities;
}

/** Steps 5 to 11 on an already valid definition. Exported so the checks can be exercised without a validator. */
export function analyzeDefinition(def: FormatDefinition, env: CompileEnv): Analysis {
  const diagnostics: Diagnostic[] = [...checkStructure(def, env)];
  const graphBuild = buildStageGraph(def);
  diagnostics.push(...graphBuild.diagnostics);
  const planBuild = buildPlan(def, env, graphBuild);
  diagnostics.push(...planBuild.diagnostics);
  diagnostics.push(...checkStages(def, env, planBuild));
  diagnostics.push(...checkEdges(def, env, graphBuild, planBuild));
  diagnostics.push(...checkLTextCoverage(def));
  return {
    diagnostics,
    graph: graphBuild.graph,
    plan: planBuild.plan,
    capabilities: deriveCapabilities(def),
  };
}

function compileValid(validation: ValidationResult, env: CompileEnv): CompileResult {
  if (!validation.ok) {
    return invalid(
      validation.issues.map((issue) => diag(SCHEMA_CODES[issue.code], issue.pointer, issue.params)),
    );
  }
  // The validator's value is cloned so the frozen result never shares objects with anything a caller holds.
  const definition = structuredClone(validation.value);
  const diagnostics: Diagnostic[] = validation.notes.map((note) =>
    diag('rule_unknown_primitive', note.pointer, { kind: note.params.kind }),
  );
  const analysis = analyzeDefinition(definition, env);
  diagnostics.push(...analysis.diagnostics);
  const sorted = sortDiagnostics(diagnostics);
  return {
    ok: !sorted.some((d) => d.severity === 'error'),
    hash: contentHash(definition),
    definition,
    diagnostics: sorted,
    capabilities: analysis.capabilities,
    graph: analysis.graph,
    plan: analysis.plan,
  };
}

export function compileWithValidator(
  validate: Validator,
  cache: LruCache<CompileResult>,
): (input: unknown, env?: CompileEnv) => CompileResult {
  return (input, env = CURRENT_ENV) => {
    const inspected = inspectJson(input);
    if (!inspected.ok) return deepFreeze(invalid([inspectionFailure(inspected)]));

    let cacheKey: string;
    try {
      cacheKey = `${contentHash(input)}|${envKey(env)}`;
    } catch {
      return deepFreeze(invalid([diag('schema_type', '', { limit: 'not_json' })]));
    }
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;

    const result = deepFreeze(compileValid(validate(input), env));
    cache.set(cacheKey, result);
    return result;
  };
}
