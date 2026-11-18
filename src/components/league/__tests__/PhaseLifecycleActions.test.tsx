/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import PhaseLifecycleActions from '../PhaseLifecycleActions';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();
const phase = { id: 'phase', season_id: 'league', name: 'Finals', status: 'active', archived: false } as const;
const endpoint = '/api/seasons/league/phases/phase';
const flags = { canDelete: false, formatManaged: false };

beforeAll(() => {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.checkVisibility = () => true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' }));
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('keeps Cancel focused and only reopens with explicit confirmation on the owned route', async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: {} }));
  render(withI18n(<PhaseLifecycleActions {...flags} phase={{ ...phase, status: 'completed' }} />));
  expect(screen.queryByRole('button', { name: 'Mark Completed' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  const reopen = screen.getByRole('button', { name: 'Reopen' });
  await user.click(reopen);
  const dialog = screen.getByRole('alertdialog', { name: 'Reopen “Finals”?' });
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  expect(document.activeElement).toBe(cancel);
  await user.click(cancel);
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(reopen);
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({
    method: 'PATCH', body: '{"status":"active"}',
  }));
});

it('offers restore without editing archived status and respects format ownership', async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: {} }));
  render(withI18n(<PhaseLifecycleActions phase={{ ...phase, archived: true }} canDelete formatManaged />));
  expect(screen.queryByRole('button', { name: /Mark Completed|Reopen|Delete/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Restore' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({
    method: 'PATCH', body: '{"archived":false}',
  }));
});

it('confirms site-admin deletion without hiding a committed rebuild warning', async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(Response.json({
    success: true, data: { rebuild_warning: { error: 'Phase deleted; usage rebuild failed', code: 'delete_rebuild_aggregates_failed' } },
  }));
  render(withI18n(<PhaseLifecycleActions {...flags} phase={phase} canDelete />));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Phase deleted; usage rebuild failed')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to league phases' }).getAttribute('href')).toMatch(/^\/admin\/leagues\/league/);
  expect(router.push).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({
    method: 'DELETE', body: '{"confirm":true}',
  }));
});
