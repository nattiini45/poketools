/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { visibleAdminNav, type AdminRoles } from '../adminNav';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: '/admin' as string,
  openAssistant: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('../assistant/AssistantDrawer', () => ({ openAdminAssistant: mocks.openAssistant, ASSISTANT_LAUNCHER_ATTR: 'data-assistant-launcher' }));

import AdminCommandMenu from '../AdminCommandMenu';

const SITE_ADMIN: AdminRoles = { isSiteAdmin: true, isSuperadmin: false };
const RESOURCE_ADMIN: AdminRoles = { isSiteAdmin: false, isSuperadmin: false };

function mount(roles: AdminRoles = SITE_ADMIN, { assistantEnabled = false, open = true }: { assistantEnabled?: boolean; open?: boolean } = {}) {
  const onOpenChange = vi.fn();
  render(
    withI18n(<AdminCommandMenu open={open} onOpenChange={onOpenChange} groups={visibleAdminNav({ ...roles, assistantEnabled })} assistantEnabled={assistantEnabled} />),
  );
  return { onOpenChange };
}

const option = (name: string | RegExp) => screen.queryByRole('option', { name });

beforeEach(() => {
  // jsdom has no matchMedia (the @fluid hover hook asks for a coarse pointer) and no ResizeObserver (the list's scroll area).
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.push.mockClear();
  mocks.openAssistant.mockClear();
  mocks.pathname = '/admin';
});

describe('AdminCommandMenu', () => {
  it('renders no dialog while closed', () => {
    mount(SITE_ADMIN, { open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled dialog with a focused search field when open', async () => {
    mount();
    expect(await screen.findByRole('dialog', { name: 'Admin command menu' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Go to a page or run an action…'));
  });

  it('lists the pages a site admin may open, and the shell actions', async () => {
    mount();
    await screen.findByRole('dialog');
    for (const name of [/^Overview/, /^Matches/, /^Players/, /^Wiki moderation/, /^Data tools/, /^Formats/, /^Rulesets/, /^New competition/, /^Back to site/]) {
      expect(option(name), String(name)).toBeTruthy();
    }
    expect(option(/League trash/)).toBeNull();
  });

  it('shows a resource admin no site-admin pages', async () => {
    mount(RESOURCE_ADMIN);
    await screen.findByRole('dialog');
    expect(option(/^Matches/)).toBeTruthy();
    expect(option(/^Formats/)).toBeTruthy();
    for (const name of [/^Players/, /^Achievements/, /^Wiki moderation/, /^Social/, /^Data tools/, /^Meta data/, /^Audit log/, /^Test players/]) {
      expect(option(name), String(name)).toBeNull();
    }
  });

  it('lists Leagues and Tournaments instead of the Competitions section', async () => {
    mount();
    await screen.findByRole('dialog');
    expect(option(/^Leagues/)).toBeTruthy();
    expect(option(/^Tournaments/)).toBeTruthy();
    expect(option(/^Archived leagues/)).toBeTruthy();
    expect(option(/^Competitions/)).toBeNull();
  });

  it('filters the rows as the admin types', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('combobox'), 'ruleset');
    expect(option(/^Rulesets/)).toBeTruthy();
    expect(option(/^Matches/)).toBeNull();
    expect(option(/^Players/)).toBeNull();

    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zzzz-nothing');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No page or action matches.')).toBeTruthy();
  });

  it('opens the highlighted page with Enter', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = mount();
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('combobox'), 'tournaments');
    await user.keyboard('{Enter}');
    expect(mocks.push).toHaveBeenCalledWith('/admin/tournaments');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens a page on click, too', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.click(option(/^Matches/)!);
    expect(mocks.push).toHaveBeenCalledWith('/admin/matches');
  });

  it('offers no assistant action or page while the assistant is off', async () => {
    mount(SITE_ADMIN, { assistantEnabled: false });
    await screen.findByRole('dialog');
    expect(option(/^Open assistant/)).toBeNull();
    expect(option(/^Assistant/)).toBeNull();
  });

  it('runs the assistant action when enabled', async () => {
    const user = userEvent.setup();
    mount(SITE_ADMIN, { assistantEnabled: true });
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('combobox'), 'open assistant');
    await user.keyboard('{Enter}');
    expect(mocks.openAssistant).toHaveBeenCalledTimes(1);
  });

  it('drops the assistant action on the assistant\'s own pages', async () => {
    mocks.pathname = '/admin/assistant';
    mount(SITE_ADMIN, { assistantEnabled: true });
    await screen.findByRole('dialog');
    expect(option(/^Open assistant/)).toBeNull();
    expect(option(/^Assistant/)).toBeTruthy();
  });
});
