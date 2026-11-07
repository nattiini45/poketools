'use client';

import { useEffect, useId, useRef } from 'react';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ActionIssue, ActionIssueCode } from '@/lib/format-engine/runtime/actions';
import SpeciesLabel from './SpeciesLabel';

/** Every problem code of a pick, so a new code in `runtime/actions.ts` is a type error here until it has a sentence. */
const ISSUE_CODES = {
  format_not_running: true,
  action_unknown: true,
  window_closed: true,
  actor_without_link: true,
  step_unknown: true,
  wrong_count: true,
  resource_unknown: true,
  domain_unknown: true,
  domain_locked: true,
  item_outside_domain: true,
  where_false: true,
  distinct_attr_duplicate: true,
  duplicate_item: true,
  capacity_exceeded: true,
  resource_item_taken: true,
} as const satisfies Record<ActionIssueCode, true>;

const isKnownCode = (code: string): code is ActionIssueCode => Object.prototype.hasOwnProperty.call(ISSUE_CODES, code);

export interface ActionIssuesProps {
  issues: readonly ActionIssue[];
}

/**
 * The problems the server found in a pick (a 422 answer), as a list tied to the step and entry each one is about.
 * Focus moves to the list whenever a new set of problems arrives, so a keyboard or screen-reader user lands on it.
 */
export default function ActionIssues({ issues }: ActionIssuesProps) {
  const t = useT(formatRuntimePlayerMessages);
  const headingId = useId();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [issues]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={headingId}
      className="space-y-1 rounded-poke-md border border-poke-danger/20 bg-poke-danger-light px-3 py-2 text-sm text-poke-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-poke-focus"
    >
      <p id={headingId} className="font-heading font-semibold">
        {t('issue.heading')}
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.step ?? 'x'}-${issue.item_id ?? 'x'}-${index}`}>
            {issue.step !== undefined && <span className="font-semibold">{t('issue.step', { number: issue.step + 1 })}: </span>}
            {issue.item_id !== undefined && (
              <span className="font-semibold">
                <SpeciesLabel id={issue.item_id} />:{' '}
              </span>
            )}
            {isKnownCode(issue.code) ? t(`issue.${issue.code}`) : t('issue.unknown')}
          </li>
        ))}
      </ul>
    </div>
  );
}
