'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocale } from '@/i18n/client';
import { renderDiagnostic, type Diagnostic, type FormatDefinition } from '@/lib/format-kit/client';
import { errorId, fieldId } from '@/lib/format-studio/editor/targets';
import { issuesByPointer, issuesUnder } from '@/lib/format-studio/editor/preview';
import { cn } from '@/lib/utils/cn';

/** The id of the heading at the top of the inspector; choosing an outline item moves focus here. */
export const INSPECTOR_HEADING_ID = 'fe-inspector-heading';

interface FieldIssues {
  diagnostics: readonly Diagnostic[];
  byPointer: ReadonlyMap<string, readonly Diagnostic[]>;
  definition: FormatDefinition | null;
}

const NO_ISSUES: FieldIssues = { diagnostics: [], byPointer: new Map(), definition: null };

const FieldIssuesContext = createContext<FieldIssues>(NO_ISSUES);

interface FieldIssuesProviderProps {
  diagnostics: readonly Diagnostic[];
  /** With the document, stage and rule keys in a sentence read as names. */
  definition: FormatDefinition | null;
  children: ReactNode;
}

/** Hands the compiler's findings to the fields below it; a field reads the ones at its own pointer. */
export function FieldIssuesProvider({ diagnostics, definition, children }: FieldIssuesProviderProps) {
  const value = useMemo<FieldIssues>(
    () => ({ diagnostics, byPointer: issuesByPointer(diagnostics), definition }),
    [diagnostics, definition],
  );
  return <FieldIssuesContext.Provider value={value}>{children}</FieldIssuesContext.Provider>;
}

interface FieldStateOptions {
  /** A plain hint shown while there is no finding. */
  hint?: string | null;
  /** The field's own typing problem (for example text that is not a number). */
  localError?: string | null;
  /** Take the findings anywhere below the pointer, not only at it (text with two languages, a ruleset ref). */
  under?: boolean;
}

export interface FieldState {
  /** The control's id (`fieldId(pointer)`). */
  id: string;
  /** The id of the message node (`errorId(pointer)`). */
  messageId: string;
  invalid: boolean;
  /** `aria-describedby` for the control; undefined when there is nothing to say. */
  describedBy: string | undefined;
  /** Sentences for the findings at this field. */
  sentences: string[];
  localError: string | null;
  hint: string | null;
}

/** The ids, ARIA values and sentences of one field, from the findings the provider holds. */
export function useFieldState(pointer: string, options: FieldStateOptions = {}): FieldState {
  const issues = useContext(FieldIssuesContext);
  const locale = useLocale();
  const found = options.under ? issuesUnder(issues.diagnostics, pointer) : (issues.byPointer.get(pointer) ?? []);
  const sentences = found.map((d) => renderDiagnostic(d, locale, issues.definition ?? undefined));
  const localError = options.localError ?? null;
  const hint = options.hint ?? null;
  const hasMessage = sentences.length > 0 || localError !== null || hint !== null;
  return {
    id: fieldId(pointer),
    messageId: errorId(pointer),
    invalid: localError !== null || found.some((d) => d.severity === 'error'),
    describedBy: hasMessage ? errorId(pointer) : undefined,
    sentences,
    localError,
    hint,
  };
}

/** The ARIA attributes a control takes from its field state. */
export function ariaOf(state: FieldState): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return {
    ...(state.invalid ? { 'aria-invalid': true as const } : {}),
    ...(state.describedBy !== undefined ? { 'aria-describedby': state.describedBy } : {}),
  };
}

/**
 * The message node of a field: its findings as plain sentences, then its own typing problem, else the hint.
 * Nothing is rendered when there is nothing to say, and then the control has no `aria-describedby`.
 */
export function FieldMessage({ state, className }: { state: FieldState; className?: string }) {
  if (state.describedBy === undefined) return null;
  const lines = [...state.sentences, ...(state.localError !== null ? [state.localError] : [])];
  if (lines.length === 0 && state.hint !== null) lines.push(state.hint);
  return (
    <div id={state.messageId} className={cn('space-y-0.5 text-sm', state.invalid ? 'text-poke-danger' : 'text-poke-text-muted', className)}>
      {lines.map((line, i) => (
        <p key={i} className="break-words">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The findings at one pointer that no single control owns (a whole section, a stage), as a message node. */
export function PointerMessage({ pointer, hint, className }: { pointer: string; hint?: string; className?: string }) {
  const state = useFieldState(pointer, { hint: hint ?? null });
  return <FieldMessage state={state} className={className} />;
}
