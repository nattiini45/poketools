/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Player, PlayerStatus } from '@/types/player';
import PlayerRoster from '../PlayerRoster';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/players',
  useSearchParams: () => new URLSearchParams(),
}));

const base: Player = {
  id: 'p-1',
  name: 'Misty',
  discord_id: '123456789012345678',
  auth_user_id: null,
  ps_username: 'MistyPS',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_test_account: false,
  is_guest: false,
  status: 'active',
  suspended_until: null,
  ban_reason: null,
  joined_date: null,
  avatar_url: null,
  avatar_config: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const sanctions: Record<PlayerStatus, Partial<Player>> = {
  active: {},
  suspended: { suspended_until: '2099-01-01T00:00:00.000Z' },
  banned: { ban_reason: 'Cheating' },
};

async function rowFor(status: PlayerStatus): Promise<HTMLElement> {
  const player = { ...base, status, ...sanctions[status] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [player], total: 1 }))));
  render(withI18n(<PlayerRoster canManageCreators={false} />));
  const cell = await screen.findByRole('cell', { name: 'Misty' });
  return cell.closest('tr') as HTMLElement;
}

describe('PlayerRoster discipline actions by player status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<[PlayerStatus, string[], string[]]>([
    ['active', ['Suspend', 'Ban'], ['Reinstate']],
    ['suspended', ['Reinstate'], ['Suspend', 'Ban']],
    ['banned', ['Reinstate'], ['Suspend', 'Ban']],
  ])('a %s player offers %j and not %j', async (status, shown, hidden) => {
    const row = await rowFor(status);
    for (const name of shown) expect(within(row).getByRole('button', { name })).toBeTruthy();
    for (const name of hidden) expect(within(row).queryByRole('button', { name })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});
