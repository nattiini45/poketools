/** @vitest-environment jsdom */
/**
 * The settings "Push alerts" card (docs/push.md): lists the player's devices from GET /api/push/subscriptions,
 * recognises this browser by fingerprint, removes a device (another one by row id, this one through the browser
 * layer), and says in the viewer's language what is stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const browser = vi.hoisted(() => ({
  thisDeviceFingerprint: vi.fn(),
  disablePush: vi.fn(),
}));

vi.mock('@/lib/push/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/client')>()),
  thisDeviceFingerprint: browser.thisDeviceFingerprint,
  disablePush: browser.disablePush,
}));

import PushDevicesCard from '../PushDevicesCard';

const PHONE = {
  id: 'dev-phone',
  label: 'Chrome on Android',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastSuccessAt: '2026-10-27T18:30:00.000Z',
  fingerprint: 'aaaaaaaaaaaaaaaa',
};
const LAPTOP = {
  id: 'dev-laptop',
  label: null,
  createdAt: '2026-10-05T10:00:00.000Z',
  lastSuccessAt: null,
  fingerprint: 'bbbbbbbbbbbbbbbb',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function listResponse(devices: unknown[], enabled = true) {
  return json(200, { success: true, data: { enabled, devices } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function show(locale: 'en' | 'de' = 'en') {
  return render(withI18n(<PushDevicesCard />, { locale }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'configured-key');
  browser.thisDeviceFingerprint.mockResolvedValue(PHONE.fingerprint);
  browser.disablePush.mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('PushDevicesCard', () => {
  it('renders nothing (and asks nothing) when the build has no push key', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    const fetchMock = stubFetch(() => listResponse([]));
    const { container } = show();
    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists the devices with label, dates and a This device badge on the matching row', async () => {
    stubFetch(() => listResponse([PHONE, LAPTOP]));
    show();
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(within(items[0]).getByText('Chrome on Android')).toBeTruthy();
    expect(within(items[0]).getByText('This device')).toBeTruthy();
    expect(items[0].textContent).toMatch(/Added 1 Oct 2026/);
    expect(items[0].textContent).toMatch(/Last alert/);

    expect(within(items[1]).getByText('Unknown device')).toBeTruthy();
    expect(within(items[1]).queryByText('This device')).toBeNull();
    expect(items[1].textContent).toMatch(/No alert delivered yet/);
  });

  it('shows the empty state and always the privacy note', async () => {
    stubFetch(() => listResponse([]));
    show();
    await screen.findByText(/No device has push alerts turned on yet/);
    expect(screen.getByText(/stores one push address with your account until you remove it or delete your account/)).toBeTruthy();
    expect(screen.getByText(/sent to your browser vendor’s push service/)).toBeTruthy();
  });

  it('is in German', async () => {
    stubFetch(() => listResponse([PHONE]));
    show('de');
    await screen.findByText('Hinzugefügt am', { exact: false });
    expect(screen.getByText('Push-Benachrichtigungen')).toBeTruthy();
    expect(screen.getByText('Dieses Gerät')).toBeTruthy();
    expect(screen.getByText(/bis du das Gerät entfernst oder dein Konto löschst/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chrome on Android entfernen' })).toBeTruthy();
  });

  it('removes another device by row id and refreshes the list', async () => {
    const user = userEvent.setup();
    let devices = [PHONE, LAPTOP];
    const fetchMock = stubFetch((_url, init) => {
      if (init?.method === 'DELETE') {
        devices = devices.filter((d) => d.id !== 'dev-laptop');
        return json(200, { success: true, data: { removed: true } });
      }
      return listResponse(devices);
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Remove Unknown device' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Unknown device' })).toBeNull());
    const del = fetchMock.mock.calls.find((call) => call[1]?.method === 'DELETE');
    expect(JSON.parse(del?.[1]?.body as string)).toEqual({ id: 'dev-laptop' });
    expect(browser.disablePush).not.toHaveBeenCalled();
    expect(screen.getByText('Device removed.')).toBeTruthy();
  });

  it('removes THIS browser through the browser layer so its subscription goes too', async () => {
    const user = userEvent.setup();
    let devices = [PHONE];
    const fetchMock = stubFetch(() => listResponse(devices));
    browser.disablePush.mockImplementation(async () => {
      devices = [];
      return { ok: true };
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Remove Chrome on Android' }));

    await screen.findByText(/No device has push alerts turned on yet/);
    expect(browser.disablePush).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(false);
  });

  it('treats an already-gone device (404) as removed', async () => {
    const user = userEvent.setup();
    let devices = [PHONE, LAPTOP];
    stubFetch((_url, init) => {
      if (init?.method === 'DELETE') {
        devices = [PHONE];
        return json(404, { success: false, error: 'Push device not found', code: 'push_device_not_found' });
      }
      return listResponse(devices);
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Remove Unknown device' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed removal keeps the row and shows the server error in the viewer language', async () => {
    const user = userEvent.setup();
    stubFetch((_url, init) =>
      init?.method === 'DELETE'
        ? json(500, { success: false, error: 'Failed to remove the push device', code: 'push_unsubscribe_failed' })
        : listResponse([PHONE, LAPTOP]),
    );
    show('de');
    await user.click(await screen.findByRole('button', { name: 'Unbekanntes Gerät entfernen' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Das Push-Gerät konnte nicht entfernt werden.');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('a failed list shows the error instead of an empty list', async () => {
    stubFetch(() => json(500, { success: false, error: 'Failed to load push devices', code: 'push_list_failed' }));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Failed to load push devices');
    expect(screen.queryByText(/No device has push alerts turned on yet/)).toBeNull();
  });

  it('warns when the server has no push configuration', async () => {
    stubFetch(() => listResponse([PHONE], false));
    show();
    await screen.findByText('Push alerts are not set up on this site.');
  });

  it('never prints an endpoint or key (the API does not send them)', async () => {
    stubFetch(() => listResponse([PHONE]));
    const { container } = show();
    await screen.findByText('Chrome on Android');
    expect(container.innerHTML).not.toMatch(/fcm\.googleapis|p256dh|endpoint/i);
  });
});
