/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { PublishDialog, ShareDialog } from '../EditorDialogs';

/**
 * The share and publish dialogs stay mounted while the editor switches teams ("New team" clears `teamId`): what they
 * show belongs to the team it was made for, never to the previous one.
 */

const TEAM_A = '00000000-0000-4000-8000-00000000000a';
const TEAM_B = '00000000-0000-4000-8000-00000000000b';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('ShareDialog', () => {
  it('drops the previous team\'s link after New team and for another team', async () => {
    fetchMock.mockReturnValueOnce(ok({ success: true, shareUrl: 'https://poke.example/teams/shared/token-a' }));
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<ShareDialog open onClose={() => {}} teamId={TEAM_A} />));

    await user.click(screen.getByRole('button', { name: 'Generate Share Link' }));
    expect(await screen.findByDisplayValue('https://poke.example/teams/shared/token-a')).toBeTruthy();

    rerender(withI18n(<ShareDialog open onClose={() => {}} teamId={null} />));
    expect(screen.queryByDisplayValue('https://poke.example/teams/shared/token-a')).toBeNull();
    expect(screen.getByText('Save your team first before sharing.')).toBeTruthy();

    rerender(withI18n(<ShareDialog open onClose={() => {}} teamId={TEAM_B} />));
    expect(screen.queryByDisplayValue('https://poke.example/teams/shared/token-a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate Share Link' })).toBeTruthy();
  });
});

describe('PublishDialog', () => {
  it('shows "Published" only for the team that was published', async () => {
    fetchMock.mockReturnValueOnce(ok({ success: true }));
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<PublishDialog open onClose={() => {}} teamId={TEAM_A} />));

    await user.type(screen.getByPlaceholderText('e.g. Hyper Offense Rain'), 'Rain');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published!')).toBeTruthy();

    rerender(withI18n(<PublishDialog open onClose={() => {}} teamId={TEAM_B} />));
    expect(screen.queryByText('Published!')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });
});
