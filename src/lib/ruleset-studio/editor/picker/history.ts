/**
 * Undo and redo of list edits: a bounded stack of before-and-after states of one list (a category's ban, unban and
 * allowlist, or the clause switches). Pure and immutable.
 *
 * Only list edits are recorded. Text fields keep the browser's own undo, and an operation that rewrites the whole base
 * (a rebase, applying the Smogon tour bans) clears the stack, because an older list state would no longer fit what the
 * list is written against. Restoring an entry replaces the whole list, so undo is exact however the list changed since.
 */
import type { CategoryRules, RulesetCategory, RulesetDocument } from '@/lib/ruleset-kit/types';

/** What an entry changes: one of the four categories or the clause switches. */
export type HistoryTarget = RulesetCategory | 'clauses';

type ClauseState = RulesetDocument['clauses'];

export type HistoryValue = CategoryRules | ClauseState;

export interface HistoryEntry {
  target: HistoryTarget;
  before: HistoryValue;
  after: HistoryValue;
  /** How many entries the edit touched and the first one, for the announcement ("12 entries unbanned"). */
  count: number;
  firstId: string | null;
  action: 'ban' | 'unban' | 'reset' | 'mode' | 'clause';
}

export interface History {
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** The most edits kept. */
export const HISTORY_LIMIT = 200;

export function valueOf(doc: RulesetDocument, target: HistoryTarget): HistoryValue {
  return target === 'clauses' ? doc.clauses : doc[target];
}

export function withValue(doc: RulesetDocument, target: HistoryTarget, value: HistoryValue): RulesetDocument {
  return { ...doc, [target]: value };
}

/** Records an edit; a new edit drops whatever could have been redone. */
export function record(history: History, entry: HistoryEntry): History {
  const past = [...history.past, entry];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] };
}

/** Records the difference between two documents for one target; nothing when the target did not change. */
export function recordDiff(
  history: History,
  before: RulesetDocument,
  after: RulesetDocument,
  target: HistoryTarget,
  meta: Pick<HistoryEntry, 'count' | 'firstId' | 'action'>,
): History {
  const b = valueOf(before, target);
  const a = valueOf(after, target);
  if (b === a) return history;
  return record(history, { target, before: b, after: a, ...meta });
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

export interface HistoryStep {
  history: History;
  doc: RulesetDocument;
  entry: HistoryEntry;
}

/** Undoes the newest edit: restores its `before` and moves it to the redo side. */
export function undo(history: History, doc: RulesetDocument): HistoryStep | null {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, entry] },
    doc: withValue(doc, entry.target, entry.before),
    entry,
  };
}

/** Redoes the newest undone edit. */
export function redo(history: History, doc: RulesetDocument): HistoryStep | null {
  const entry = history.future[history.future.length - 1];
  if (entry === undefined) return null;
  return {
    history: { past: [...history.past, entry], future: history.future.slice(0, -1) },
    doc: withValue(doc, entry.target, entry.after),
    entry,
  };
}

export function clearHistory(): History {
  return EMPTY_HISTORY;
}
