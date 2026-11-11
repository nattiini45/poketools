/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { visibleAdminNav, type AdminRoles } from '../adminNav';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: '/admin' as string,
  openAssistant: vi.fn(),
  fetch: vi.fn(),
}));

const INDEX = [
  { id: 'season-1', name: 'Kanto Cup', kind: 'league', archived: false },
  { id: 'tour-1', name: 'Friday Rumble', kind: 'tournament', archived: false },
  { id: 'season-0', name: 'Johto Classic', kind: 'league', archived: true },
];
const indexResponse = (body: unknown) => ({ json: async () => body });

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
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(indexResponse({ success: true, data: [] }));
  vi.stubGlobal('fetch', mocks.fetch);
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

describe('AdminCommandMenu: Jump to', () => {
  function mountClosed(locale: 'en' | 'de' = 'en') {
    const groups = visibleAdminNav({ ...SITE_ADMIN, assistantEnabled: false });
    const ui = (open: boolean) =>
      withI18n(<AdminCommandMenu open={open} onOpenChange={vi.fn()} groups={groups} assistantEnabled={false} />, { locale });
    const view = render(ui(false));
    return { open: () => view.rerender(ui(true)), close: () => view.rerender(ui(false)) };
  }

  it('does not ask for the index before the menu is first opened', async () => {
    const menu = mountClosed();
    await Promise.resolve();
    expect(mocks.fetch).not.toHaveBeenCalled();
    menu.open();
    await screen.findByRole('dialog');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/command-index');
  });

  it('asks once across several opens', async () => {
    mocks.fetch.mockResolvedValue(indexResponse({ success: true, data: INDEX }));
    const menu = mountClosed();
    for (let i = 0; i < 3; i++) {
      menu.open();
      await screen.findByRole('dialog');
      await screen.findByRole('option', { name: /^Kanto Cup/ });
      menu.close();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('adds one Jump to item per competition and opens the league workspace or the tournament rounds page', async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(indexResponse({ success: true, data: INDEX }));
    const menu = mountClosed();
    menu.open();
    expect(await screen.findByText('Jump to')).toBeTruthy();
    expect(await screen.findAllByText(/^(Kanto Cup|Friday Rumble|Johto Classic)$/)).toHaveLength(3);
    expect(option(/^Kanto Cup\s*League/)).toBeTruthy();
    expect(option(/^Johto Classic\s*Archived league/)).toBeTruthy();

    await user.click(option(/^Kanto Cup/)!);
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/leagues/season-1');

    menu.open();
    await user.type(screen.getByRole('combobox'), 'rumble');
    await user.keyboard('{Enter}');
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/tournaments/tour-1/rounds');
  });

  it('finds a competition by its kind, and words the kind in German', async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(indexResponse({ success: true, data: INDEX }));
    const menu = mountClosed('de');
    menu.open();
    await screen.findByRole('option', { name: /^Friday Rumble/ });
    expect(screen.getByText('Springe zu')).toBeTruthy();
    await user.type(screen.getByRole('combobox'), 'turnier');
    expect(option(/^Friday Rumble/)).toBeTruthy();
    expect(option(/^Kanto Cup/)).toBeNull();
  });

  it('works as before while the index is still loading', async () => {
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    const menu = mountClosed();
    menu.open();
    await screen.findByRole('dialog');
    expect(option(/^Matches/)).toBeTruthy();
    expect(screen.queryByText('Jump to')).toBeNull();
  });

  it('keeps the menu usable and says so quietly when the load fails, and asks again at the next open', async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValueOnce(indexResponse({ success: false, error: 'Failed to load the command index' }));
    const menu = mountClosed();
    menu.open();
    expect(await screen.findByText('The competitions could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Jump to')).toBeTruthy();
    expect(option(/^Matches/)).toBeTruthy();
    // No retry loop while the menu stays open.
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // The line is no row to pick, and it stays while the admin types.
    await user.type(screen.getByRole('combobox'), 'rulesets');
    expect(option(/^Rulesets/)).toBeTruthy();
    expect(screen.getByText('The competitions could not be loaded.')).toBeTruthy();
    await user.click(screen.getByText('The competitions could not be loaded.'));
    expect(mocks.push).not.toHaveBeenCalled();

    mocks.fetch.mockResolvedValueOnce(indexResponse({ success: true, data: INDEX }));
    menu.close();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    menu.open();
    expect(await screen.findByRole('option', { name: /^Kanto Cup/ })).toBeTruthy();
    expect(screen.queryByText('The competitions could not be loaded.')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('words a failure the server sent a code for in the viewer\'s language', async () => {
    mocks.fetch.mockResolvedValueOnce(indexResponse({ success: false, error: 'Admin access required', code: 'forbidden' }));
    const menu = mountClosed('de');
    menu.open();
    expect(await screen.findByText(/Berechtigung/)).toBeTruthy();
    expect(screen.queryByText('Admin access required')).toBeNull();
  });

  it('words a failure the server sent a code for, and a lost connection too', async () => {
    mocks.fetch.mockResolvedValueOnce(indexResponse({ success: false, error: 'Admin access required', code: 'forbidden' }));
    const menu = mountClosed();
    menu.open();
    // English shows the server's own text; another language goes through the catalog (next test).
    expect(await screen.findByText('Admin access required')).toBeTruthy();
    menu.close();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    menu.open();
    expect(await screen.findByText('Network error. Check your connection and try again.')).toBeTruthy();
    expect(option(/^Matches/)).toBeTruthy();
  });
});
