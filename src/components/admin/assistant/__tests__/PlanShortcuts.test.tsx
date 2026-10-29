/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import ClarificationCard from '../ClarificationCard';
import Composer from '../Composer';
import PlanPanel from '../PlanPanel';
import type { ClarificationView, PlanView } from '../types';

const plan = (overrides: Partial<PlanView> = {}): PlanView => ({
  id: 'p1',
  mode: 'create',
  status: 'drafting',
  revision: 2,
  code: 'abcdef01',
  title: 'Gen 9 OU league',
  contentLocale: 'en',
  ready: true,
  assumptions: [],
  blockers: [],
  warnings: [],
  sections: [],
  ...overrides,
});

const blocked = plan({
  ready: false,
  blockers: [{ code: 'roster_unresolved', section: 'roster', path: '/slots/roster', params: { count: 3 } }],
});

describe('the Plan panel footer and its Fix shortcuts', () => {
  it('offers Build when nothing blocks, and writes the sentence for the admin instead of staging anything', async () => {
    const onAsk = vi.fn();
    render(withI18n(<PlanPanel plan={plan()} onAsk={onAsk} canAsk />));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Build' }));
    expect(onAsk).toHaveBeenCalledWith('Please prepare the build for this plan.');
  });

  it('disables Build with the reason while a blocker stands, and offers Fix next to the blocker', async () => {
    const onAsk = vi.fn();
    render(withI18n(<PlanPanel plan={blocked} onAsk={onAsk} canAsk />));
    expect((screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Build is not possible yet')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fix' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0][0]).toMatch(/^Please fix this: 3 roster entries are not matched to a player yet\.$/);
  });

  it('is German in German', () => {
    render(withI18n(<PlanPanel plan={blocked} onAsk={vi.fn()} canAsk />, { locale: 'de' }));
    expect((screen.getByRole('button', { name: 'Bauen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Beheben' })).toBeTruthy();
  });

  it('disables both while the conversation cannot take a message, and offers neither without a composer', () => {
    const { unmount } = render(withI18n(<PlanPanel plan={blocked} onAsk={vi.fn()} canAsk={false} />));
    expect((screen.getByRole('button', { name: 'Fix' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const done = render(withI18n(<PlanPanel plan={plan({ status: 'built' })} onAsk={vi.fn()} canAsk />));
    expect((screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement).disabled).toBe(true);
    done.unmount();
    render(withI18n(<PlanPanel plan={blocked} />));
    expect(screen.queryByRole('button', { name: 'Build' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fix' })).toBeNull();
  });

  it('sticks the action bar to the bottom edge on a phone', () => {
    const { container } = render(withI18n(<PlanPanel plan={plan()} onAsk={vi.fn()} canAsk />));
    expect(container.querySelector('[data-plan-footer]')?.className).toMatch(/\bsticky\b.*\bbottom-0\b/);
  });
});

describe('Composer prefill', () => {
  const props = { disabled: false, sending: false, maxChars: 200, canContinue: false, onSend: vi.fn(async () => true), onContinue: vi.fn() };

  it('puts the sentence in the box for each new request and sends nothing by itself', () => {
    const { rerender } = render(withI18n(<Composer {...props} prefill={null} />));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe('');
    rerender(withI18n(<Composer {...props} prefill={{ text: 'Please fix this: a', nonce: 1 }} />));
    expect(box.value).toBe('Please fix this: a');
    rerender(withI18n(<Composer {...props} prefill={{ text: 'Please fix this: b', nonce: 2 }} />));
    expect(box.value).toBe('Please fix this: b');
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

describe('ClarificationCard', () => {
  const choice: ClarificationView = {
    kind: 'choice',
    question: 'Which Monday?',
    options: [
      { value: '2026-11-02', label: 'Next Monday (2 Nov)' },
      { value: '2026-11-09', label: 'The Monday after' },
    ],
  };

  it('sends the chosen option as the admin\'s own message', async () => {
    const onAnswer = vi.fn();
    render(withI18n(<ClarificationCard clarification={choice} answered={false} onAnswer={onAnswer} />));
    expect(screen.getByText('Which Monday?')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'The Monday after' }));
    expect(onAnswer).toHaveBeenCalledWith('The Monday after');
  });

  it('sends several choices as one answer', async () => {
    const onAnswer = vi.fn();
    render(withI18n(<ClarificationCard clarification={{ ...choice, kind: 'multi' }} answered={false} onAnswer={onAnswer} />));
    const user = userEvent.setup();
    expect((screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Next Monday (2 Nov)' }));
    await user.click(screen.getByRole('checkbox', { name: 'The Monday after' }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith('Next Monday (2 Nov), The Monday after');
  });

  it('points a free question, a date and a number to the message box', () => {
    const { rerender } = render(withI18n(<ClarificationCard clarification={{ kind: 'text', question: 'Name?', options: [] }} answered={false} />));
    expect(screen.getByText('Answer in the message box below.')).toBeTruthy();
    rerender(withI18n(<ClarificationCard clarification={{ kind: 'date', question: 'When?', options: [] }} answered={false} />));
    expect(screen.getByText('Answer with a date in the message box below.')).toBeTruthy();
    rerender(withI18n(<ClarificationCard clarification={{ kind: 'number', question: 'How many?', options: [] }} answered={false} />));
    expect(screen.getByText('Answer with a number in the message box below.')).toBeTruthy();
  });

  it('keeps an answered question as history without buttons', () => {
    render(withI18n(<ClarificationCard clarification={choice} answered onAnswer={vi.fn()} />));
    const card = screen.getByRole('region', { name: 'The assistant asks' });
    expect(within(card).getByText('Answered')).toBeTruthy();
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('does not offer to send while no message can be sent', () => {
    render(withI18n(<ClarificationCard clarification={choice} answered={false} />));
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('is German in German', () => {
    render(withI18n(<ClarificationCard clarification={choice} answered={false} onAnswer={vi.fn()} />, { locale: 'de' }));
    expect(screen.getByRole('region', { name: 'Der Assistent fragt' })).toBeTruthy();
  });
});
