/**
 * `FormatView`: the plain, locale-free shape the Studio hands to its client components. It is a compile result with
 * the frozen parts copied into plain arrays, the stage graph reduced to its order, and the coverage computed. Nothing
 * in it is localized (diagnostics are codes and params; the renderer turns them into sentences with the viewer's
 * language), so one view serves either language and survives `JSON.stringify` unchanged.
 *
 * Client-safe: only the kit's client entry is imported.
 */
import {
  CURRENT_ENV,
  computeCoverage,
  type CompileEnv,
  type CompileResult,
  type Coverage,
  type Diagnostic,
  type FormatDefinition,
  type StagePlan,
} from '@/lib/format-kit/client';
import type { FormatCapabilities } from '@/lib/season/format-capabilities';

export interface FormatView {
  ok: boolean;
  hash: string | null;
  definition: FormatDefinition | null;
  diagnostics: Diagnostic[];
  plan: StagePlan[] | null;
  /** Stage keys in display order: the graph order, then any stage the graph left out (a cycle). */
  order: string[];
  capabilities: FormatCapabilities | null;
  coverage: Coverage | null;
  /** Stored ruleset ids with their names, for the ruleset sentences. */
  rulesets: { id: string; name: string }[];
}

export interface FormatViewExtras {
  rulesets?: { id: string; name: string }[];
}

const plain = <T>(value: T): T => structuredClone(value);

export function toFormatView(result: CompileResult, extras: FormatViewExtras = {}): FormatView {
  const definition = result.definition === null ? null : plain(result.definition as FormatDefinition);
  const graphOrder = result.graph === null ? [] : [...result.graph.order];
  const order = [...graphOrder];
  if (definition !== null) {
    for (const stage of definition.stages) {
      if (!order.includes(stage.key)) order.push(stage.key);
    }
  }
  return {
    ok: result.ok,
    hash: result.hash,
    definition,
    diagnostics: plain([...result.diagnostics]) as Diagnostic[],
    plan: result.plan === null ? null : (plain([...result.plan]) as StagePlan[]),
    order: definition === null ? [] : order,
    capabilities: result.capabilities === null ? null : { ...result.capabilities },
    coverage: definition === null ? null : computeCoverage(definition),
    rulesets: (extras.rulesets ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
  };
}

/**
 * The compile environment of a live league: today's product limits plus the roster size when the league has at
 * least two participants (a smaller roster would turn every size check into noise).
 */
export function legacyCompileEnv(participantCount: number): CompileEnv {
  if (Number.isSafeInteger(participantCount) && participantCount >= 2) return { ...CURRENT_ENV, rosterSize: participantCount };
  return CURRENT_ENV;
}
