/**
 * Compiles a ruleset document: structure, semantics, effective rules and hashes in one pure call. Server (at publish,
 * with the dex-backed preset and id sets) and browser (the editor's live summary, with the same data fetched once)
 * run the SAME function, so a document the editor shows as clean is one the server publishes.
 *
 * Diagnostics carry a code, a severity, a JSON pointer, params and, where a mechanical repair exists, `fix`: JSON patch
 * operations (the format kit's `applyPatch`) that remove exactly that diagnostic without adding an error. Codes only:
 * the words are the UI's (`ruleset-studio/diagnostics`). `error` blocks a publish; `warning` and `info` do not.
 *
 * What the compile deliberately does NOT do: enforce a clause. Only the Species Clause and the Item Clause are
 * enforced by the validator; every other known clause is reported once as `clause_informational` (info), so the editor
 * can mark it ("shown, not enforced") instead of pretending.
 *
 * `unknown_entry` is SERVER-AUTHORITATIVE: it needs the id sets of the dex. The context's `known` is optional, and
 * without it the check is skipped (a client that has not loaded the catalog index yet shows no such warning, the server
 * always does).
 */
import { contentHash, type JsonValue } from '@/lib/studio-core/json';
import type { PatchOp } from '@/lib/studio-core/patch';
import { getClause, isEnforcedClause } from '@/lib/pkmn/clauses';
import { parseFormatId } from '@/lib/pkmn/format-id';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { computeEffective } from './effective';
import { validateRulesetDocument } from './validate';
import {
  RULESET_CATEGORIES,
  type ResolvedRules,
  type RulesetCategory,
  type RulesetDocument,
} from './types';

export type RulesetDiagnosticCode =
  | 'invalid_structure'
  | 'preset_unknown'
  | 'entry_in_ban_and_unban'
  | 'allowlist_with_bans'
  | 'allowlist_empty'
  | 'duplicate_entry'
  | 'unknown_clause'
  | 'clause_in_add_and_remove'
  | 'unknown_entry'
  | 'ban_redundant'
  | 'unban_not_banned'
  | 'clause_informational';

export type RulesetDiagnosticSeverity = 'error' | 'warning' | 'info';

export const RULESET_DIAGNOSTIC_SEVERITY: Readonly<Record<RulesetDiagnosticCode, RulesetDiagnosticSeverity>> = {
  invalid_structure: 'error',
  preset_unknown: 'error',
  entry_in_ban_and_unban: 'error',
  allowlist_with_bans: 'error',
  allowlist_empty: 'error',
  duplicate_entry: 'error',
  unknown_clause: 'error',
  clause_in_add_and_remove: 'error',
  unknown_entry: 'warning',
  ban_redundant: 'warning',
  unban_not_banned: 'warning',
  clause_informational: 'info',
};

export interface RulesetDiagnostic {
  code: RulesetDiagnosticCode;
  severity: RulesetDiagnosticSeverity;
  /** RFC 6901 JSON pointer into the document ('' for the whole document). */
  path: string;
  params?: Readonly<Record<string, string | number>>;
  /** Patch operations that remove this diagnostic; absent when no mechanical repair exists. */
  fix?: readonly PatchOp[];
}

export interface CompileContext {
  /** The resolved rules of the document's base preset; `null` when the base is blank or the preset is unknown. */
  preset: PresetRules | null;
  /** The ids the dex knows per category for the document's generation and universe (for `unknown_entry`). */
  known?: Partial<Record<RulesetCategory, ReadonlySet<string>>>;
}

export interface CompileResult {
  /** No `error` diagnostic. */
  ok: boolean;
  diagnostics: RulesetDiagnostic[];
  /** The normalized document; `null` when its structure is invalid. */
  document: RulesetDocument | null;
  /** The effective rules; `null` unless `ok`. */
  resolved: ResolvedRules | null;
  /** Hash of the canonical document; `null` unless `ok`. */
  content_hash: string | null;
  /** Hash of the canonical resolved rules; `null` unless `ok`. */
  resolved_hash: string | null;
}

function diag(
  code: RulesetDiagnosticCode,
  path: string,
  params?: Record<string, string | number>,
  fix?: readonly PatchOp[],
): RulesetDiagnostic {
  const out: RulesetDiagnostic = { code, severity: RULESET_DIAGNOSTIC_SEVERITY[code], path };
  if (params !== undefined) out.params = params;
  if (fix !== undefined) out.fix = fix;
  return out;
}

/** Indexes of the second and later occurrences in `ids`. */
function duplicateIndexes(ids: readonly string[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) out.push(index);
    else seen.add(id);
  });
  return out;
}

function checkList(
  doc: RulesetDocument,
  category: RulesetCategory,
  ctx: CompileContext,
  out: RulesetDiagnostic[],
): void {
  const rules = doc[category];
  const base = doc.base.kind === 'preset' ? ctx.preset?.[category] ?? null : null;
  const known = ctx.known?.[category];
  const lists: Array<['ban' | 'unban' | 'allow', readonly string[]]> = [
    ['ban', rules.ban],
    ['unban', rules.unban],
    ['allow', rules.allow ?? []],
  ];

  for (const [name, ids] of lists) {
    const path = `/${category}/${name}`;
    for (const index of duplicateIndexes(ids)) {
      out.push(diag('duplicate_entry', `${path}/${index}`, { id: ids[index], category }, [{ op: 'remove', path: `${path}/${index}` }]));
    }
    if (known !== undefined) {
      ids.forEach((id, index) => {
        if (!known.has(id)) out.push(diag('unknown_entry', `${path}/${index}`, { id, category }));
      });
    }
  }

  if (rules.allow !== null) {
    if (rules.ban.length > 0 || rules.unban.length > 0) {
      out.push(
        diag('allowlist_with_bans', `/${category}`, { category }, [
          { op: 'replace', path: `/${category}/ban`, value: [] },
          { op: 'replace', path: `/${category}/unban`, value: [] },
        ]),
      );
    }
    if (rules.allow.length === 0) out.push(diag('allowlist_empty', `/${category}/allow`, { category }));
    return;
  }

  const unbanned = new Set(rules.unban);
  rules.ban.forEach((id, index) => {
    if (unbanned.has(id)) {
      out.push(diag('entry_in_ban_and_unban', `/${category}/ban/${index}`, { id, category }, [{ op: 'remove', path: `/${category}/ban/${index}` }]));
    }
  });

  // Redundancy against the base is only meaningful for a block-mode preset list.
  if (base !== null && base.mode === 'block') {
    const baseIds = new Set(base.ids);
    rules.ban.forEach((id, index) => {
      if (baseIds.has(id) && !unbanned.has(id)) out.push(diag('ban_redundant', `/${category}/ban/${index}`, { id, category }, [{ op: 'remove', path: `/${category}/ban/${index}` }]));
    });
    rules.unban.forEach((id, index) => {
      if (!baseIds.has(id)) out.push(diag('unban_not_banned', `/${category}/unban/${index}`, { id, category }, [{ op: 'remove', path: `/${category}/unban/${index}` }]));
    });
  } else if (doc.base.kind === 'blank' && category !== 'pokemon') {
    // A blank base bans nothing, so only the Pokémon unban means something (legal despite the format key's tier).
    rules.unban.forEach((id, index) => {
      out.push(diag('unban_not_banned', `/${category}/unban/${index}`, { id, category }, [{ op: 'remove', path: `/${category}/unban/${index}` }]));
    });
  }
}

function checkClauses(doc: RulesetDocument, out: RulesetDiagnostic[]): void {
  const removed = new Set(doc.clauses.remove);
  for (const [name, ids] of [['add', doc.clauses.add], ['remove', doc.clauses.remove]] as const) {
    for (const index of duplicateIndexes(ids)) {
      out.push(diag('duplicate_entry', `/clauses/${name}/${index}`, { id: ids[index], category: 'clauses' }, [{ op: 'remove', path: `/clauses/${name}/${index}` }]));
    }
    ids.forEach((id, index) => {
      if (getClause(id) === undefined) {
        out.push(diag('unknown_clause', `/clauses/${name}/${index}`, { id }, [{ op: 'remove', path: `/clauses/${name}/${index}` }]));
      }
    });
  }
  doc.clauses.add.forEach((id, index) => {
    if (removed.has(id)) out.push(diag('clause_in_add_and_remove', `/clauses/add/${index}`, { id }, [{ op: 'remove', path: `/clauses/add/${index}` }]));
  });
}

/** One `clause_informational` info per effective clause the validator does not enforce. */
function informationalClauses(resolved: ResolvedRules, out: RulesetDiagnostic[]): void {
  for (const id of resolved.clauses) {
    if (getClause(id) !== undefined && !isEnforcedClause(id)) out.push(diag('clause_informational', '/clauses', { id }));
  }
}

/**
 * Validates, checks and resolves a ruleset document. `ok` means no error diagnostic: then `document`, `resolved` and
 * both hashes are set. A document with a structural issue returns one `invalid_structure` error per issue and nothing
 * else.
 */
export function compileRuleset(input: unknown, ctx: CompileContext): CompileResult {
  const parsed = validateRulesetDocument(input);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.issues.map((issue) => diag('invalid_structure', issue.path, { issue: issue.code })),
      document: null,
      resolved: null,
      content_hash: null,
      resolved_hash: null,
    };
  }
  const doc = parsed.document;
  const diagnostics: RulesetDiagnostic[] = [];

  if (doc.base.kind === 'preset' && (ctx.preset === null || ctx.preset.id !== doc.base.preset)) {
    const gen = parseFormatId(doc.base.preset)?.gen ?? 9;
    diagnostics.push(
      diag('preset_unknown', '/base/preset', { preset: doc.base.preset }, [
        { op: 'replace', path: '/base', value: { kind: 'blank', gen, doubles: false, universe: 'standard' } },
      ]),
    );
  }
  checkClauses(doc, diagnostics);
  for (const category of RULESET_CATEGORIES) checkList(doc, category, ctx, diagnostics);

  const ok = diagnostics.every((d) => d.severity !== 'error');
  if (!ok) return { ok: false, diagnostics, document: doc, resolved: null, content_hash: null, resolved_hash: null };

  const resolved = computeEffective(doc, doc.base.kind === 'preset' ? ctx.preset : null);
  informationalClauses(resolved, diagnostics);
  return {
    ok: true,
    diagnostics,
    document: doc,
    resolved,
    content_hash: contentHash(doc as unknown as JsonValue),
    resolved_hash: contentHash(resolved as unknown as JsonValue),
  };
}
