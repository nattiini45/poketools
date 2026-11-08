/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { NotificationView } from '@/lib/format-engine/notifications/types';
import { ltext } from '@/lib/studio-core/ltext';

vi.mock('@/lib/format-engine/notifications/client-api', () => ({
  loadInbox: vi.fn(),
  loadUnreadCount: vi.fn(),
  markRead: vi.fn(),
}));

import { loadInbox, loadUnreadCount, markRead } from '@/lib/format-engine/notifications/client-api';
import NotificationBell from '../NotificationBell';

const challenge: NotificationView = {
  id: 'n-1',
  kind: 'challenge_expired',
  side: 'defender',
  counterparty: { id: 'p-2', name: 'Mara' },
  created_at: '2026-11-08T10:00:00.000Z',
  read: false,
  league: { id: 's-1', name: 'Winter Cup' },
  href: '/dashboard/leagues/s-1/play',
};
const notice: NotificationView = {
  id: 'n-2',
  kind: 'rule_notice',
  message: ltext('en', 'The pool is open.', 'Der Pool ist offen.'),
  created_at: '2026-11-08T09:00:00.000Z',
  read: true,
  league: { id: 's-1', name: 'Winter Cup' },
  href: '/dashboard/leagues/s-1/play',
};

const inbox = (items: NotificationView[], unread = 1, hasMore = false) => ({ ok: true as const, data: { items, unread, has_more: hasMore } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadUnreadCount).mockResolvedValue({ ok: true, data: { unread: 1 } });
  vi.mocked(loadInbox).mockResolvedValue(inbox([challenge, notice]));
  vi.mocked(markRead).mockResolvedValue({ ok: true, data: { unread: 0 } });
});

async function openPanel(options: { locale?: 'en' | 'de' } = {}) {
  const user = userEvent.setup();
  render(withI18n(<NotificationBell />, options));
  const label = options.locale === 'de' ? /Benachrichtigungen, 1 ungelesen/ : /Notifications, 1 unread/;
  await user.click(await screen.findByRole('button', { name: label }));
  return user;
}

describe('NotificationBell', () => {
  it('names the unread count on the button and announces it', async () => {
    render(withI18n(<NotificationBell />));
    expect((await screen.findByRole('button', { name: 'Notifications, 1 unread' })).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe('1 unread notifications');
  });

  it('caps the badge', async () => {
    vi.mocked(loadUnreadCount).mockResolvedValue({ ok: true, data: { unread: 250 } });
    render(withI18n(<NotificationBell />));
    await screen.findByRole('button', { name: 'Notifications, 250 unread' });
    screen.getByText('99+');
  });

  it('opens a labelled panel, moves focus into it and lists the notifications with their unread state', async () => {
    await openPanel();
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((await screen.findByRole('link', { name: /The challenge from Mara expired before you answered/ })).textContent).toContain('Unread');
    const read = screen.getByRole('link', { name: /The pool is open/ });
    expect(read.textContent).not.toContain('Unread');
    expect(read.getAttribute('href')).toBe('/dashboard/leagues/s-1/play');
  });

  it('renders in German, the format\'s text included', async () => {
    await openPanel({ locale: 'de' });
    await screen.findByRole('link', { name: /Die Herausforderung von Mara ist abgelaufen/ });
    screen.getByRole('link', { name: /Der Pool ist offen/ });
  });

  it('says "former player" for somebody who left the league', async () => {
    vi.mocked(loadInbox).mockResolvedValue(inbox([{ ...challenge, counterparty: { id: 'p-2', name: null } } as NotificationView]));
    await openPanel();
    await screen.findByRole('link', { name: /Former player/ });
  });

  it('marks everything read', async () => {
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(markRead).toHaveBeenCalledWith('all');
    await screen.findByRole('button', { name: 'Notifications' });
    expect(screen.getByRole('link', { name: /The challenge from Mara/ }).textContent).not.toContain('Unread');
  });

  it('keeps the rows unread and says so when marking fails', async () => {
    vi.mocked(markRead).mockResolvedValue({ ok: false, status: 500, error: { error: 'x' } });
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be marked as read');
    expect(screen.getByRole('link', { name: /The challenge from Mara/ }).textContent).toContain('Unread');
  });

  it('marks one notification read when it is followed, and closes', async () => {
    const user = await openPanel();
    const link = await screen.findByRole('link', { name: /The challenge from Mara/ });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(markRead).toHaveBeenCalledWith(['n-1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not mark a notification that was already read', async () => {
    const user = await openPanel();
    const link = await screen.findByRole('link', { name: /The pool is open/ });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('shows an empty state', async () => {
    vi.mocked(loadInbox).mockResolvedValue(inbox([]));
    await openPanel();
    await screen.findByText(/Nothing new/);
  });

  it('offers a retry when the list cannot be read', async () => {
    vi.mocked(loadInbox).mockResolvedValueOnce({ ok: false, status: 500, error: { error: 'x' } });
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: /The challenge from Mara/ });
  });

  it('appends the next page', async () => {
    vi.mocked(loadInbox).mockResolvedValueOnce(inbox([challenge], 1, true)).mockResolvedValueOnce(inbox([notice]));
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Show older' }));
    await screen.findByRole('link', { name: /The pool is open/ });
    expect(loadInbox).toHaveBeenLastCalledWith(1);
    screen.getByRole('link', { name: /The challenge from Mara/ });
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const user = await openPanel();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Notifications/ }));
  });

  it('polls only the count, and stops once the server says signed out', async () => {
    vi.mocked(loadUnreadCount).mockResolvedValue({ ok: false, status: 401, error: { error: 'x' } });
    render(withI18n(<NotificationBell />));
    await waitFor(() => expect(loadUnreadCount).toHaveBeenCalledTimes(1));
    expect(loadInbox).not.toHaveBeenCalled();
  });
});
