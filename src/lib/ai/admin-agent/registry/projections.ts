/**
 * Output shapes the ruleset readers and previews share: a compile check (diagnostics as codes, never prose) and a
 * resolved list cut to a readable length. Stored text inside diagnostic params is fenced (`fence.ts`).
 */
import { z } from 'zod';
import type { RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import type { ResolvedList } from '@/lib/ruleset-kit/types';
import { capped, code, userText } from './atoms';
import { fenceText } from './fence';

export const LIST_IDS_CAP = 150;
export const DIAGNOSTIC_CAP = 40;

export const listOut = z.strictObject({ mode: z.enum(['block', 'allow']), count: z.number().int(), ids: z.array(code()), truncated: z.boolean() });

export const toListOut = (list: ResolvedList) => ({
  mode: list.mode,
  count: list.ids.length,
  ids: list.ids.slice(0, LIST_IDS_CAP),
  truncated: list.ids.length > LIST_IDS_CAP,
});

export const diagnosticOut = z.strictObject({
  code: code(),
  severity: z.enum(['error', 'warning', 'info']),
  path: z.string().regex(/^(\/[A-Za-z0-9_~\-]{1,40}){0,8}$/),
  params_user_text: userText(),
  has_fix: z.boolean(),
});

export function toDiagnosticOut(diagnostic: RulesetDiagnostic) {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    // A JSON pointer into a document: structural names and indices. Anything else (a stored key) collapses to the root.
    path: /^(\/[A-Za-z0-9_~-]{1,40}){0,8}$/.test(diagnostic.path) ? diagnostic.path : '',
    // Parameters can hold ids and names copied from the document: stored text.
    params_user_text: fenceText(diagnostic.params === undefined ? '' : JSON.stringify(diagnostic.params)),
    has_fix: diagnostic.fix !== undefined && diagnostic.fix.length > 0,
  };
}

export const checkOut = z.strictObject({
  ok: z.boolean(),
  error_count: z.number().int(),
  warning_count: z.number().int(),
  diagnostics: capped(diagnosticOut),
});

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** A compile check as the model sees it: errors first, cut at `DIAGNOSTIC_CAP`. */
export function toCheckOut(check: { ok: boolean; diagnostics: readonly RulesetDiagnostic[]; truncated?: boolean }) {
  const sorted = [...check.diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const truncated = check.truncated === true || sorted.length > DIAGNOSTIC_CAP;
  return {
    ok: check.ok,
    error_count: sorted.filter((d) => d.severity === 'error').length,
    warning_count: sorted.filter((d) => d.severity === 'warning').length,
    diagnostics: {
      items: sorted.slice(0, DIAGNOSTIC_CAP).map(toDiagnosticOut),
      total: check.truncated === true ? null : sorted.length,
      truncated,
      cap: DIAGNOSTIC_CAP,
    },
  };
}
