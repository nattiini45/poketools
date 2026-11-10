/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import ActionsOverview from '../ActionsOverview';
import { SEASON, actionView, failResponse, okResponse, sent, text } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const fetchMock = vi.fn();

function mount(props: Partial<React.ComponentProps<typeof ActionsOverview>> = {}, locale: Locale = 'en') {
  return render(withI18n(<ActionsOverview seasonId={SEASON} actions={[actionView()]} canAdjust {...props} />, { locale }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('ActionsOverview', () => {
  it('shows the window, how many can act and the counts', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Gift' })).toBeTruthy();
    expect(screen.getAllByText('Open', { selector: 'span > span' }).some((element) => !element.closest('button'))).toBe(true);
    expect(screen.getByText('Locks at the close')).toBeTruthy();
    const counts = Object.fromEntries(
      Array.from(document.querySelectorAll('dl > div')).map((div) => [div.querySelector('dt')?.textContent, div.querySelector('dd')?.textContent]),
    );
    expect(counts).toEqual({ 'Can act': '3', 'Nothing yet': '1', Draft: '0', Submitted: '2', Locked: '0' });
  });

  it('a window that is open can be locked but not opened, and the other way round', () => {
    const { unmount } = mount({ actions: [actionView({ window: 'open' })] });
    expect(screen.getByRole('button', { name: 'Open Gift' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Lock Gift' }).hasAttribute('disabled')).toBe(false);
    unmount();
    mount({ actions: [actionView({ window: 'locked' })] });
    expect(screen.getByRole('button', { name: 'Open Gift' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Lock Gift' }).hasAttribute('disabled')).toBe(true);
  });

  it('a window that has not opened yet can be opened and locked', () => {
    mount({ actions: [actionView({ window: 'not_open_yet' })] });
    expect(screen.getByRole('button', { name: 'Open Gift' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Lock Gift' }).hasAttribute('disabled')).toBe(false);
  });

  it('offers no buttons when the format does not allow action adjustments', () => {
    mount({ canAdjust: false });
    expect(screen.queryByRole('button', { name: /Gift/ })).toBeNull();
    expect(screen.getByText('This format does not allow an admin to open or lock an action.')).toBeTruthy();
  });

  it('Lock asks for a reason, says what follows, then records an action adjustment and reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount();
    await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Lock Gift?')).toBeTruthy();
    expect(within(dialog).getByText(/on the next scheduled pass/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Lock' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Deadline passed');
    await user.click(confirm);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock)).toEqual({
      url: `/api/seasons/${SEASON}/format/adjustments`,
      method: 'POST',
      body: { reason: 'Deadline passed', adjustment: { kind: 'action', action: 'gift', state: 'locked' } },
    });
    expect(screen.getByText('Gift locked.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a later failure does not sit next to the success line of the earlier adjustment', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(okResponse({ adjustment_id: 'a1' }, 201))
      .mockResolvedValueOnce(failResponse(409, 'format_not_running', 'This league is not running a custom format right now.'));
    mount();
    for (const round of [1, 2]) {
      await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Deadline passed');
      await user.click(within(dialog).getByRole('button', { name: 'Lock' }));
      if (round === 1) await screen.findByText('Gift locked.');
    }
    expect((await screen.findByRole('alert')).textContent).toBe('This league is not running a custom format right now.');
    expect(screen.queryByText('Gift locked.')).toBeNull();
  });

  it('the dialog cannot be closed while the request is in flight, so its failure is never lost', async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    mount();
    await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Deadline passed');
    await user.click(within(dialog).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.keyboard('{Escape}');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    answer(failResponse(503, 'upstream_failed', 'The service is not available right now.'));
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe('The service is not available right now.');
    // With the answer in, the dialog closes again.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Open sends state open and does not mention the follow-up', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount({ actions: [actionView({ window: 'not_open_yet' })] });
    await user.click(screen.getByRole('button', { name: 'Open Gift' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/scheduled pass/)).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Early start');
    await user.click(within(dialog).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((sent(fetchMock).body as { adjustment: unknown }).adjustment).toEqual({ kind: 'action', action: 'gift', state: 'open' });
  });

  it('cancel records nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a stale page (409) is shown in the dialog and the page is read again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_not_running', 'This league is not running a custom format right now.'));
    mount();
    await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Lock' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('This league is not running a custom format right now.');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('a format without player actions says so', () => {
    mount({ actions: [] });
    expect(screen.getByText('This format has no player actions.')).toBeTruthy();
  });

  it('renders in German', () => {
    mount({ actions: [actionView({ label: text('Geschenk'), window: 'locked' })] }, 'de');
    expect(screen.getByRole('heading', { name: 'Geschenk' })).toBeTruthy();
    expect(screen.getByText('Gesperrt', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Geschenk öffnen' })).toBeTruthy();
  });
});

describe('ActionsOverview: focus', () => {
  it('after Lock the refreshed page disables the button, so focus goes to the status line', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount();
    await user.click(screen.getByRole('button', { name: 'Lock Gift' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Deadline passed');
    await user.click(within(dialog).getByRole('button', { name: 'Lock' }));
    await screen.findByText('Gift locked.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
  });
});
