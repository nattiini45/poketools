/**
 * The editor's live compile and what is read from its result: the issue rows, counts per section and the publish gate.
 * The compile is the kit's `compileRuleset`, the SAME function the server publishes with; the browser gives it the
 * resolved base preset (fetched from the server once) and, when the catalog index of a category has loaded, the ids the
 * dex knows (for `unknown_entry`). Pure and client-safe.
 */
import { compileRuleset, type CompileResult, type RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { sectionOfPointer, type EditorSection } from './targets';

export interface EditorEnv {
  /** The resolved rules of the document's base preset; null for a blank base or while they load. */
  preset: PresetRules | null;
  /** True while the document names a preset whose rules have not arrived: the compile then cannot judge the base. */
  presetPending: boolean;
  /** The ids per category that the loaded catalog index knows. */
  known?: Partial<Record<RulesetCategory, ReadonlySet<string>>>;
}

/** Compiles the working document. While a preset's rules are still loading the base is not judged (no `preset_unknown`). */
export function compileDraft(doc: unknown, env: EditorEnv): CompileResult {
  const result = compileRuleset(doc, { preset: env.preset, ...(env.known === undefined ? {} : { known: env.known }) });
  if (!env.presetPending) return result;
  return {
    ...result,
    ok: false,
    diagnostics: result.diagnostics.filter((d) => d.code !== 'preset_unknown'),
    resolved: null,
    content_hash: null,
    resolved_hash: null,
  };
}

export interface IssueRow {
  /** Stable key for lists: code, path and parameters. */
  key: string;
  diagnostic: RulesetDiagnostic;
  section: EditorSection;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** The rows of the Issues tab: errors first, then warnings, then notes, each group in document order. */
export function toIssueRows(diagnostics: readonly RulesetDiagnostic[]): IssueRow[] {
  return diagnostics
    .map((diagnostic, index) => ({
      key: `${diagnostic.code}:${diagnostic.path}:${diagnostic.params?.id ?? ''}:${index}`,
      diagnostic,
      section: sectionOfPointer(diagnostic.path),
      index,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.diagnostic.severity] - SEVERITY_ORDER[b.diagnostic.severity] || a.index - b.index)
    .map(({ key, diagnostic, section }) => ({ key, diagnostic, section }));
}

export function issueCounts(diagnostics: readonly RulesetDiagnostic[]): { errors: number; warnings: number; notes: number } {
  let errors = 0;
  let warnings = 0;
  let notes = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errors += 1;
    else if (d.severity === 'warning') warnings += 1;
    else notes += 1;
  }
  return { errors, warnings, notes };
}

/** The diagnostics of one section (the outline's badge). */
export function issuesInSection(diagnostics: readonly RulesetDiagnostic[], section: EditorSection): RulesetDiagnostic[] {
  return diagnostics.filter((d) => sectionOfPointer(d.path) === section);
}

/**
 * Whether the draft may be published: not while it has an error, and not when both hashes equal the latest published
 * version's (the server refuses exactly that: a catalog-only difference is still worth a new version).
 */
export function publishGate(
  result: CompileResult,
  published: { contentHash: string; resolvedHash: string | null } | null,
): { allowed: boolean; reason: 'errors' | 'nothing_new' | null } {
  if (!result.ok || result.document === null) return { allowed: false, reason: 'errors' };
  if (published !== null && result.content_hash === published.contentHash && (published.resolvedHash === null || result.resolved_hash === published.resolvedHash)) {
    return { allowed: false, reason: 'nothing_new' };
  }
  return { allowed: true, reason: null };
}
