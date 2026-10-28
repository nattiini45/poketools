'use client';

/**
 * The "Push alerts" settings card (docs/push.md): the devices that get draft turn alerts, each with a remove
 * button, and the privacy note. Turning a device ON happens from the bell in a draft room (it needs this browser's
 * permission prompt and subscription); this card lists and removes.
 *
 * Hidden when the build has no VAPID public key. Rows come from `GET /api/push/subscriptions` (label and dates
 * only, never keys or endpoints); this browser's own row is recognised by a hash of its endpoint
 * (`thisDeviceFingerprint`) and is removed through `disablePush()`, which also drops the browser's subscription.
 */
import { useCallback, useEffect, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsPlayers } from '@/i18n/messages/errors';
import { pushMessages } from '@/i18n/messages/push';
import { disablePush, PUSH_API_PATH, pushPublicKey, thisDeviceFingerprint } from '@/lib/push/client';
import type { PushDevice } from '@/lib/supabase/queries/push-subscriptions';
import type { ApiResult } from '@/types/api';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; devices: PushDevice[]; enabled: boolean }
  | { phase: 'failed'; error: ApiErrorLike | null };

async function fetchDevices(): Promise<{ devices: PushDevice[]; enabled: boolean }> {
  const res = await fetch(PUSH_API_PATH, { cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as ApiResult<{ devices: PushDevice[]; enabled: boolean }> | null;
  if (!res.ok || !body || !body.success) throw body ?? new Error(`HTTP ${res.status}`);
  return body.data;
}

export default function PushDevicesCard() {
  const t = useT(pushMessages);
  const f = useFormatter();
  const errorText = useApiErrorText(errorsPlayers);
  const configured = pushPublicKey() !== '';
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [mine, setMine] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<ApiErrorLike | null>(null);
  const [notice, setNotice] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchDevices();
      setLoad({ phase: 'ready', ...data });
    } catch (err) {
      setLoad({ phase: 'failed', error: toApiErrorLike(err) });
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const [data, fingerprint] = await Promise.all([fetchDevices(), thisDeviceFingerprint()]);
        if (cancelled) return;
        setMine(fingerprint);
        setLoad({ phase: 'ready', ...data });
      } catch (err) {
        if (!cancelled) setLoad({ phase: 'failed', error: toApiErrorLike(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const remove = useCallback(
    async (device: PushDevice) => {
      setRemovingId(device.id);
      setRemoveError(null);
      setNotice(false);
      try {
        if (device.fingerprint === mine) {
          // This browser: remove the server row and the browser's own subscription.
          const result = await disablePush();
          if (!result.ok) {
            setRemoveError(result.failure?.error ?? { code: 'push_unsubscribe_failed' });
            return;
          }
          setMine(null);
        } else {
          const res = await fetch(PUSH_API_PATH, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: device.id }),
          });
          const body = (await res.json().catch(() => null)) as ApiResult<unknown> | null;
          // 404: already gone (a push service reported the endpoint dead); the list refresh shows it.
          if (!res.ok && res.status !== 404) {
            setRemoveError(body && !body.success ? toApiErrorLike(body) : { code: 'push_unsubscribe_failed' });
            return;
          }
        }
        setNotice(true);
        await refresh();
      } catch (err) {
        console.error('[settings] removing a push device failed:', err);
        setRemoveError(toApiErrorLike(err));
      } finally {
        setRemovingId(null);
      }
    },
    [mine, refresh],
  );

  if (!configured) return null;

  const devices = load.phase === 'ready' ? load.devices : [];

  return (
    <Card padding="lg">
      <h2 className="text-lg font-heading font-bold text-poke-text-primary mb-1">{t('settings.heading')}</h2>
      <p className="text-sm text-poke-text-secondary mb-4">{t('settings.description')}</p>

      {load.phase === 'ready' && !load.enabled ? <Alert variant="warning" className="mb-4">{t('settings.notConfigured')}</Alert> : null}
      {load.phase === 'failed' ? (
        <Alert variant="error" className="mb-4">
          {load.error?.code ? errorText(load.error) : t('settings.loadFailed')}
        </Alert>
      ) : null}

      <h3 className="text-sm font-semibold text-poke-text-primary mb-2">{t('settings.devicesHeading')}</h3>
      {load.phase === 'loading' ? <p className="text-sm text-poke-text-muted">{t('settings.loading')}</p> : null}
      {load.phase === 'ready' && devices.length === 0 ? <p className="text-sm text-poke-text-muted">{t('settings.empty')}</p> : null}
      {devices.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {devices.map((device) => {
            const name = device.label ?? t('settings.unknownDevice');
            const removing = removingId === device.id;
            return (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-poke-md border border-poke-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-poke-text-primary">
                    <span className="truncate">{name}</span>
                    {device.fingerprint === mine ? <Badge>{t('settings.thisDevice')}</Badge> : null}
                  </p>
                  <p className="text-xs text-poke-text-muted">
                    {t('settings.added', { date: f.instant(device.createdAt, 'date') })}
                    {' · '}
                    {device.lastSuccessAt
                      ? t('settings.lastDelivery', { date: f.instant(device.lastSuccessAt, 'dateTime') })
                      : t('settings.noDelivery')}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={removing}
                  disabled={removingId !== null}
                  aria-label={t('settings.removeAria', { device: name })}
                  onClick={() => void remove(device)}
                >
                  {removing ? t('settings.removing') : t('settings.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p aria-live="polite" className="min-h-5 pt-2 text-xs text-poke-text-muted">
        {notice ? t('settings.removed') : ''}
      </p>
      {removeError ? (
        <Alert variant="error" className="mt-2">
          {removeError.code ? errorText(removeError) : t('settings.removeFailed')}
        </Alert>
      ) : null}

      <p className="mt-3 text-xs text-poke-text-muted">{t('settings.privacy')}</p>
    </Card>
  );
}
