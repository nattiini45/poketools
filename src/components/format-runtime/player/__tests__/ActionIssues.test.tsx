/** @vitest-environment jsdom */
/**
 * `ActionIssues`: every problem code of a pick has a sentence in both languages, a code the client does not know falls
 * back to a generic sentence, and the list names the step (1-based) and the entry each problem is about.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ActionIssue, ActionIssueCode } from '@/lib/format-engine/runtime/actions';
import ActionIssues from '../ActionIssues';

/** Mirrors `ActionIssueCode`; `satisfies` keeps this list complete when a code is added. */
const CODES = {
  format_not_running: 1,
  action_unknown: 1,
  window_closed: 1,
  actor_without_link: 1,
  actor_not_in_league: 1,
  step_unknown: 1,
  wrong_count: 1,
  resource_unknown: 1,
  domain_unknown: 1,
  domain_locked: 1,
  item_outside_domain: 1,
  where_false: 1,
  distinct_attr_duplicate: 1,
  duplicate_item: 1,
  capacity_exceeded: 1,
  resource_item_taken: 1,
} as const satisfies Record<ActionIssueCode, 1>;

describe('ActionIssues', () => {
  it.each(['en', 'de'] as const)('has a distinct sentence for every code (%s)', (locale) => {
    const t = createTranslator(formatRuntimePlayerMessages, locale);
    const sentences = (Object.keys(CODES) as ActionIssueCode[]).map((code) => t(`issue.${code}`));
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) expect(sentence).toMatch(/\S/);
    render(withI18n(<ActionIssues issues={(Object.keys(CODES) as ActionIssueCode[]).map((code): ActionIssue => ({ code }))} />, { locale }));
    for (const sentence of sentences) expect(screen.getAllByText(sentence, { exact: false }).length).toBeGreaterThan(0);
  });

  it('prefixes the step (counted from 1) and the entry of an issue', () => {
    const t = createTranslator(formatRuntimePlayerMessages, 'en');
    render(withI18n(<ActionIssues issues={[{ code: 'resource_item_taken', step: 1, item_id: 'charizard' }]} />));
    const item = screen.getByRole('listitem');
    expect(item.textContent).toBe(`${t('issue.step', { number: 2 })}: Charizard: ${t('issue.resource_item_taken')}`);
  });

  it('shows a generic sentence for a code it does not know', () => {
    const t = createTranslator(formatRuntimePlayerMessages, 'en');
    render(withI18n(<ActionIssues issues={[{ code: 'brand_new_code' as ActionIssueCode }]} />));
    expect(screen.getByRole('listitem').textContent).toBe(t('issue.unknown'));
  });
});
