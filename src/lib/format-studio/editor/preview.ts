/**
 * What the editor's preview panels read: the compile of the working document, the rows of the Issues tab, the
 * publish gate and the schedule estimate. Pure and client-safe; the compiler is the kit's browser entry.
 *
 * The editor compiles against the rulesets that exist (`rulesetIds`), so a stage that names a ruleset that was
 * deleted is flagged before a league attaches the format. The publish route compiles without ruleset ids, so the
 * editor is at most stricter than publishing, never looser.
 */
import {
  CURRENT_ENV,
  SCHEDULE_MAX_PLAYERS,
  SCHEDULE_MIN_PLAYERS,
  compile,
  estimateSchedule,
  type CompileEnv,
  type CompileResult,
  type Diagnostic,
  type DiagnosticCode,
  type Fix,
  type ScheduleEstimate,
  type Severity,
} from '@/lib/format-kit/client';
import { pointerTarget, type Selection } from './targets';

export { METRIC_KEYS } from './catalog';

/** The compile environment of the editor: today's product plus the rulesets that exist. */
export function editorEnv(rulesetIds?: ReadonlySet<string>): CompileEnv {
  return rulesetIds === undefined ? CURRENT_ENV : { ...CURRENT_ENV, rulesetIds };
}

/** The browser compile of a working document. Never throws. */
export function compileDraft(doc: unknown, rulesetIds?: ReadonlySet<string>): CompileResult {
  return compile(doc, editorEnv(rulesetIds));
}

export interface IssueRow {
  /** `${code}:${pointer}:${n}`, unique within one compile. */
  id: string;
  severity: Severity;
  code: DiagnosticCode;
  pointer: string;
  /** The part of the form the issue belongs to, `null` when the form has no place for it. */
  selection: Selection | null;
  fixes: readonly Fix[];
  /** An unknown or reserved member: the editor can remove it. */
  canRemove: boolean;
}

const REMOVABLE: ReadonlySet<DiagnosticCode> = new Set<DiagnosticCode>(['schema_unknown_key', 'schema_not_available_yet']);

/** One row per diagnostic, in the compiler's order (errors first). */
export function toIssueRows(diagnostics: readonly Diagnostic[]): IssueRow[] {
  const seen = new Map<string, number>();
  return diagnostics.map((d) => {
    const base = `${d.code}:${d.json_pointer}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return {
      id: `${base}:${n}`,
      severity: d.severity,
      code: d.code,
      pointer: d.json_pointer,
      selection: pointerTarget(d.json_pointer),
      fixes: d.fixes,
      canRemove: REMOVABLE.has(d.code),
    };
  });
}

/** The diagnostics at exactly one pointer, keyed by pointer. */
export function issuesByPointer(diagnostics: readonly Diagnostic[]): Map<string, Diagnostic[]> {
  const out = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = out.get(d.json_pointer);
    if (list) list.push(d);
    else out.set(d.json_pointer, [d]);
  }
  return out;
}

/** The diagnostics at a pointer or below it (`prefix` itself or `prefix/...`). */
export function issuesUnder(diagnostics: readonly Diagnostic[], prefix: string): Diagnostic[] {
  return diagnostics.filter((d) => d.json_pointer === prefix || d.json_pointer.startsWith(`${prefix}/`));
}

export function issueCounts(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number; notes: number } {
  const counts = { errors: 0, warnings: 0, notes: 0 };
  for (const d of diagnostics) {
    if (d.severity === 'error') counts.errors += 1;
    else if (d.severity === 'warning') counts.warnings += 1;
    else counts.notes += 1;
  }
  return counts;
}

/**
 * Whether the draft may be published: not while it has an error (or no definition), and not when it equals the
 * published version (`publishedHash` is the content hash of the latest published version).
 */
export function publishGate(
  result: CompileResult,
  publishedHash: string | null,
): { allowed: boolean; reason: 'errors' | 'nothing_new' | null } {
  if (result.definition === null || result.diagnostics.some((d) => d.severity === 'error')) {
    return { allowed: false, reason: 'errors' };
  }
  if (publishedHash !== null && result.hash === publishedHash) return { allowed: false, reason: 'nothing_new' };
  return { allowed: true, reason: null };
}

function clampPlayers(players: number): number {
  if (!Number.isFinite(players)) return SCHEDULE_MIN_PLAYERS;
  return Math.min(Math.max(Math.trunc(players), SCHEDULE_MIN_PLAYERS), 4096);
}

/**
 * The schedule of a working document for a given roster: compiled with that roster size, so every roster stage
 * starts from `players`. `null` when the document does not compile far enough.
 */
export function scheduleFor(
  doc: unknown,
  players: number,
  roundDays: number,
  rulesetIds?: ReadonlySet<string>,
): ScheduleEstimate | null {
  const rosterSize = clampPlayers(players);
  const result = compile(doc, { ...editorEnv(rulesetIds), rosterSize });
  return estimateSchedule(result, { players: rosterSize, roundDays });
}

/** The roster sizes the Schedule tab's number field accepts. */
export const SCHEDULE_PLAYER_RANGE = { min: SCHEDULE_MIN_PLAYERS, max: SCHEDULE_MAX_PLAYERS } as const;
