import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/queries/format-notifications', () => ({
  countUnreadFormatNotifications: vi.fn(),
  listFormatNotifications: vi.fn(),
  readCurrentLeagueMembers: vi.fn(),
  readNotificationLeagueNames: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));

import { logger } from '@/lib/logger';
import {
  countUnreadFormatNotifications,
  listFormatNotifications,
  readCurrentLeagueMembers,
  readNotificationLeagueNames,
} from '@/lib/supabase/queries/format-notifications';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { loadInboxPage } from '../server';

const challenge = (id: string, seasonId: string, counterparty: string) => ({
  id,
  season_id: seasonId,
  kind: 'challenge_accepted',
  payload: { role: 'challenger', counterparty_id: counterparty },
  created_at: '2026-11-08T10:00:00.000Z',
  read_at: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(countUnreadFormatNotifications).mockResolvedValue(2);
  vi.mocked(readNotificationLeagueNames).mockResolvedValue(new Map([['s-1', 'One'], ['s-2', 'Two']]));
  vi.mocked(readCurrentLeagueMembers).mockResolvedValue(new Map([['s-1', new Set(['a'])]]));
  vi.mocked(resolvePlayerNames).mockResolvedValue({ a: 'Ada' });
});

describe('loadInboxPage', () => {
  it('masks per league and reads each lookup once, however many leagues the page holds', async () => {
    vi.mocked(listFormatNotifications).mockResolvedValue({
      rows: [challenge('n-1', 's-1', 'a'), challenge('n-2', 's-2', 'a')],
      hasMore: true,
    });
    const page = await loadInboxPage('me', 30, 0);

    expect(page).toMatchObject({ unread: 2, next_offset: 2 });
    expect(page.items.map((item) => ('counterparty' in item ? item.counterparty.name : undefined))).toEqual(['Ada', null]);
    expect(readNotificationLeagueNames).toHaveBeenCalledTimes(1);
    expect(readCurrentLeagueMembers).toHaveBeenCalledTimes(1);
    expect(readCurrentLeagueMembers).toHaveBeenCalledWith(['s-1', 's-2'], ['a']);
    expect(resolvePlayerNames).toHaveBeenCalledTimes(1);
  });

  it('moves the next page past a row it could not read', async () => {
    vi.mocked(listFormatNotifications).mockResolvedValue({ rows: [{ ...challenge('n-1', 's-1', 'a'), kind: 'nope' }], hasMore: true });
    await expect(loadInboxPage('me', 1, 4)).resolves.toMatchObject({ items: [], next_offset: 5 });
  });

  it('leaves out a row it cannot read and logs it', async () => {
    vi.mocked(listFormatNotifications).mockResolvedValue({ rows: [{ ...challenge('n-1', 's-1', 'a'), kind: 'nope' }], hasMore: false });
    const page = await loadInboxPage('me', 30, 0);
    expect(page.items).toEqual([]);
    expect(page.next_offset).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('format-engine/notifications', 'a stored notification cannot be read', { notificationId: 'n-1', kind: 'nope' });
  });
});
