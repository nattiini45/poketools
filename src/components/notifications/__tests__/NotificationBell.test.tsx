/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const inbox = (items: NotificationView[], unread = 1, hasMore = false) => ({ ok: true as const, data: { items, unread, next_offset: hasMore ? 1 : null } });

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
    expect(screen.getByRole('status').textContent).toBe('1 unread notification');
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
    await screen.findByRole('link', { name: /The challenge from|A challenge from a former player/ });
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

  it('writes a whole sentence for a former player, in German too', async () => {
    vi.mocked(loadInbox).mockResolvedValue(inbox([{ ...challenge, counterparty: { id: 'p-2', name: null } } as NotificationView]));
    await openPanel({ locale: 'de' });
    await screen.findByRole('link', { name: /Die Herausforderung eines ehemaligen Spielers ist abgelaufen/ });
  });

  it.each([
    ['challenge_created', 'defender', /Mara hat dich herausgefordert/],
    ['challenge_accepted', 'challenger', /Mara hat deine Herausforderung angenommen/],
    ['challenge_declined', 'challenger', /Mara hat deine Herausforderung abgelehnt/],
    ['challenge_expired', 'challenger', /Mara hat nicht rechtzeitig/],
    ['challenge_cancelled', 'defender', /Die Herausforderung von Mara wurde abgebrochen/],
    ['challenge_cancelled', 'challenger', /Deine Herausforderung an Mara wurde abgebrochen/],
  ])('words %s for the %s in German', async (kind, side, name) => {
    vi.mocked(loadInbox).mockResolvedValue(inbox([{ ...challenge, kind, side } as NotificationView]));
    await openPanel({ locale: 'de' });
    await screen.findByRole('link', { name });
  });

  it('does not mark anything read by opening the panel', async () => {
    await openPanel();
    await screen.findByRole('link', { name: /The challenge from Mara/ });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('counts a followed notification down at once and takes the server\'s number afterwards', async () => {
    vi.mocked(loadUnreadCount).mockResolvedValue({ ok: true, data: { unread: 5 } });
    vi.mocked(loadInbox).mockResolvedValue(inbox([challenge], 5));
    vi.mocked(markRead).mockResolvedValue({ ok: true, data: { unread: 2 } });
    const user = userEvent.setup();
    render(withI18n(<NotificationBell />));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 5 unread' }));
    const link = await screen.findByRole('link', { name: /The challenge from Mara/ });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    await screen.findByRole('button', { name: 'Notifications, 2 unread' });
  });

  it('reads the real count again when marking a followed notification fails', async () => {
    vi.mocked(markRead).mockResolvedValue({ ok: false, status: 500, error: { error: 'x' } });
    const user = await openPanel();
    const link = await screen.findByRole('link', { name: /The challenge from Mara/ });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    await waitFor(() => expect(loadUnreadCount).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
  });

  it('closes when the pointer goes down outside, and stays open inside', async () => {
    await openPanel();
    const dialog = await screen.findByRole('dialog');
    fireEvent.pointerDown(dialog);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps an Escape from reaching the page behind the panel', async () => {
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    try {
      const user = await openPanel();
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      expect(behind).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', behind);
    }
  });

  it('leaves out a row that comes twice when a new notification shifted the pages', async () => {
    vi.mocked(loadInbox).mockResolvedValueOnce(inbox([challenge], 1, true)).mockResolvedValueOnce(inbox([challenge, notice]));
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Show older' }));
    await screen.findByRole('link', { name: /The pool is open/ });
    expect(screen.getAllByRole('link', { name: /The challenge from Mara/ })).toHaveLength(1);
  });

  it('offers no more pages on the last one', async () => {
    await openPanel();
    await screen.findByRole('link', { name: /The challenge from Mara/ });
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('retries the page that failed, not the one after what it already shows', async () => {
    const user = userEvent.setup();
    render(withI18n(<NotificationBell />));
    const bell = await screen.findByRole('button', { name: /Notifications, 1 unread/ });
    await user.click(bell);
    await screen.findByRole('link', { name: /The challenge from Mara/ });
    await user.keyboard('{Escape}');
    vi.mocked(loadInbox).mockResolvedValueOnce({ ok: false, status: 500, error: { error: 'x' } });
    await user.click(bell);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loadInbox).toHaveBeenCalledTimes(3));
    expect(vi.mocked(loadInbox).mock.calls.map((call) => call[0])).toEqual([0, 0, 0]);
  });

  it('keeps focus in the panel when the pressed control goes away', async () => {
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await screen.findByRole('button', { name: 'Notifications' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notifications' }));
  });

  it('moves focus to the first new row of a page', async () => {
    vi.mocked(loadInbox).mockResolvedValueOnce(inbox([challenge], 1, true)).mockResolvedValueOnce(inbox([notice]));
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Show older' }));
    const row = await screen.findByRole('link', { name: /The pool is open/ });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('drops a list answer that started before "mark all" landed', async () => {
    let answer: (value: ReturnType<typeof inbox>) => void = () => undefined;
    vi.mocked(loadInbox)
      .mockResolvedValueOnce(inbox([challenge], 1, true))
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Show older' }));
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await screen.findByRole('button', { name: 'Notifications' });
    await act(async () => answer(inbox([notice], 9)));
    expect(screen.getByRole('button', { name: 'Notifications' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: /The pool is open/ })).toBeNull();
  });
});

describe('NotificationBell polling', () => {
  const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    if (hidden !== undefined) Object.defineProperty(document, 'hidden', hidden);
  });

  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('asks for the count every two minutes, and never for the list', async () => {
    render(withI18n(<NotificationBell />));
    await tick(0);
    expect(loadUnreadCount).toHaveBeenCalledTimes(1);
    await tick(119_000);
    expect(loadUnreadCount).toHaveBeenCalledTimes(1);
    await tick(1_000);
    expect(loadUnreadCount).toHaveBeenCalledTimes(2);
    expect(loadInbox).not.toHaveBeenCalled();
  });

  it.each([401, 403])('stops on %i', async (code) => {
    vi.mocked(loadUnreadCount).mockResolvedValue({ ok: false, status: code, error: { error: 'x' } });
    render(withI18n(<NotificationBell />));
    await tick(0);
    await tick(600_000);
    expect(loadUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('goes on after a server error', async () => {
    vi.mocked(loadUnreadCount).mockResolvedValue({ ok: false, status: 500, error: { error: 'x' } });
    render(withI18n(<NotificationBell />));
    await tick(0);
    await tick(120_000);
    expect(loadUnreadCount).toHaveBeenCalledTimes(2);
  });

  it('does not poll a hidden tab', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    render(withI18n(<NotificationBell />));
    await tick(0);
    await tick(600_000);
    expect(loadUnreadCount).toHaveBeenCalledTimes(1);
  });
});
