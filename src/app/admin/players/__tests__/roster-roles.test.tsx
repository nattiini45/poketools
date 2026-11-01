/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Player } from '@/types/player';
import PlayerRoster from '../PlayerRoster';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/players',
  useSearchParams: () => new URLSearchParams(),
}));

const linked: Player = {
  id: 'p-1',
  name: 'Brock',
  discord_id: '123456789012345678',
  auth_user_id: null,
  ps_username: 'BrockPS',
  champions_username: '',
  is_admin: true,
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

async function renderRoster(canManageCreators: boolean, protectedPlayerId: string | null = null) {
  render(withI18n(<PlayerRoster canManageCreators={canManageCreators} protectedPlayerId={protectedPlayerId} />));
  return screen.findByRole('cell', { name: 'Brock' });
}

describe('PlayerRoster roles and identity', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: [linked], total: 1 }))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers the admin toggle to the superadmin only', async () => {
    await renderRoster(true);
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('shows the admin role as a plain badge to a site admin who is not the superadmin', async () => {
    await renderRoster(false);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getByText('Admin', { selector: 'span' })).toBeTruthy();
  });

  it('has no editable Discord ID input when a linked player is edited', async () => {
    const user = userEvent.setup();
    const nameCell = await renderRoster(true);
    const row = nameCell.closest('tr');
    expect(row).not.toBeNull();

    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit' }));

    const inputs = within(row as HTMLElement).getAllByRole('textbox');
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual(['Brock', 'BrockPS']);
    expect(within(row as HTMLElement).getByText('123456789012345678')).toBeTruthy();
  });

  describe('the superadmin row', () => {
    it('offers no Edit control for the protected row, while its other actions stay', async () => {
      const nameCell = await renderRoster(false, 'p-1');
      const row = nameCell.closest('tr') as HTMLElement;

      expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(within(row).getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    it('offers Edit on every other row', async () => {
      const nameCell = await renderRoster(false, 'someone-else');
      const row = nameCell.closest('tr') as HTMLElement;

      expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
    });

    it('offers Edit when no row is protected', async () => {
      const nameCell = await renderRoster(false);
      const row = nameCell.closest('tr') as HTMLElement;

      expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
    });
  });
});