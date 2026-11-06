/** @vitest-environment jsdom */
/**
 * `PlayerFormatView` in a DOM: it shows the sections the view has, the page has ONE way to refresh (a request to the
 * `me` route, never `router.refresh()`), a result is announced in the live region, a stale answer from a card
 * reloads the page through that same path, and the view is replaced by what the reload returns.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { PlayerFormatView as ViewData } from '@/lib/format-engine/runtime/view-types';
import { ltext } from '@/lib/studio-core/ltext';
import { ANNA, ME, SEASON_ID, action, challenge, item, ladder, relation, runningView } from './fixtures';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), submit: vi.fn(), make: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/client-api')>()),
  loadMyFormatView: mocks.load,
  saveActionRequest: mocks.save,
  submitActionRequest: mocks.submit,
  makeChallengeRequest: mocks.make,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));

import PlayerFormatView from '../PlayerFormatView';

function setup(initialView: ViewData, { locale = 'en', closed = false }: { locale?: Locale; closed?: boolean } = {}) {
  const user = userEvent.setup();
  render(withI18n(<PlayerFormatView seasonId={SEASON_ID} viewerId={ME} initialView={initialView} closed={closed} />, { locale }));
  return { user, t: createTranslator(formatRuntimePlayerMessages, locale) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlayerFormatView: what it shows', () => {
  it('renders every section the view has, each under its own heading', () => {
    setup(
      runningView({
        items: [item(), item({ item_id: null, amount: 3, resource: 'coins', resource_label: ltext('en', 'Coins', 'Münzen') })],
        relations: [relation({ links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: false }] })],
        ladders: [ladder()],
      }),
    );
    for (const name of ['Your actions', 'Pairings', 'What you hold', 'Challenge ladders']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByText('x3')).toBeTruthy();
  });

  it('leaves out the sections the view has nothing for, and says when there is nothing at all', () => {
    const { t } = setup(runningView({ actions: [] }));
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText(t('page.empty'))).toBeTruthy();
  });

  it('shows the not-running notice for a view that is not running', () => {
    const { t } = setup({ running: false });
    expect(screen.getByText(t('page.notRunning'))).toBeTruthy();
  });

  it('renders in German', () => {
    setup(runningView({ ladders: [ladder()] }), { locale: 'de' });
    expect(screen.getByRole('heading', { level: 2, name: 'Deine Aktionen' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Herausforderungs-Leitern' })).toBeTruthy();
  });
});

describe('PlayerFormatView: the one reload path', () => {
  async function pickAndSubmit(user: ReturnType<typeof userEvent.setup>, submitLabel: string) {
    await user.click(screen.getByRole('checkbox', { name: 'Pikachu' }));
    await user.click(screen.getByRole('checkbox', { name: 'Charizard' }));
    await user.click(screen.getByRole('button', { name: submitLabel }));
  }

  it('after a successful submit it loads the me route once, shows the new view, and announces the result', async () => {
    const submitted = action({ submission: { state: 'submitted', picks: [{ step: 0, item_id: 'pikachu' }, { step: 0, item_id: 'charizard' }] } });
    mocks.submit.mockResolvedValue({ ok: true, data: { submission: submitted.submission } });
    mocks.load.mockResolvedValue({ ok: true, data: runningView({ actions: [submitted] }) });
    const { user, t } = setup(runningView());
    await pickAndSubmit(user, t('buttons.submit'));

    await waitFor(() => expect(screen.getByRole('button', { name: t('buttons.change') })).toBeTruthy());
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledWith(SEASON_ID);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(t('status.submitted'));
  });

  it('a sent challenge reloads through the same path and is announced in the live region', async () => {
    mocks.make.mockResolvedValue({ ok: true, data: { challenge: challenge() } });
    mocks.load.mockResolvedValue({ ok: true, data: runningView({ actions: [], ladders: [ladder({ challenges: [challenge()] })] }) });
    const { user, t } = setup(runningView({ actions: [], ladders: [ladder()] }));
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('status.challengeSent')));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t('ladder.outgoing', { name: 'Ben' }))).toBeTruthy();
  });

  it('a stale answer (the window closed) reloads through the same path and shows the locked card', async () => {
    mocks.submit.mockResolvedValue({ ok: false, status: 409, error: { code: 'action_locked' } });
    mocks.load.mockResolvedValue({ ok: true, data: runningView({ actions: [action({ window: 'locked', actionable: false })] }) });
    const { user, t } = setup(runningView());
    await pickAndSubmit(user, t('buttons.submit'));

    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    // The card now says why it is read-only, and the refusal that caused the reload stays visible above it.
    expect(screen.getAllByText(t('actions.lockedWindow'))).toHaveLength(2);
  });

  it('a reload that fails keeps the page and says so', async () => {
    mocks.submit.mockResolvedValue({ ok: true, data: { submission: { state: 'submitted', picks: [] } } });
    mocks.load.mockResolvedValue({ ok: false, status: 0, error: { code: 'network_error' } });
    const { user, t } = setup(runningView());
    await pickAndSubmit(user, t('buttons.submit'));

    await waitFor(() => expect(screen.getByText(t('status.reloadFailed'))).toBeTruthy());
    expect(screen.getByRole('heading', { level: 2, name: t('actions.heading') })).toBeTruthy();
    // The submit went through but the old view is still shown: the picks stay, and nothing says "submitted".
    expect((screen.getByRole('checkbox', { name: 'Pikachu' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Charizard' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('status').textContent).not.toBe(t('status.submitted'));
  });

  it('a reload that says the format stopped running replaces the page with the notice', async () => {
    mocks.submit.mockResolvedValue({ ok: false, status: 409, error: { code: 'format_not_running' } });
    mocks.load.mockResolvedValue({ ok: true, data: { running: false } });
    const { user, t } = setup(runningView());
    await pickAndSubmit(user, t('buttons.submit'));

    await waitFor(() => expect(screen.getByText(t('page.notRunning'))).toBeTruthy());
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a closed league shows the cards and the ladder without any control', () => {
    setup(runningView({ ladders: [ladder()] }), { closed: true });
    expect(screen.queryByRole('checkbox')).toBeNull();
    for (const button of screen.queryAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
