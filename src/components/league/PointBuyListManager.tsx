'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PointBuyListVersion } from '@/types/point-buy';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft, errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { draftLegacyLeagueAdminPoolMessages } from '@/i18n/messages/draft/legacy/league-admin/pool';

interface PointBuyListManagerProps {
  seasonId: string;
  currentListId: string | null;
}

/** A failed read or bind keeps the API body; other failures keep a message key. */
type ListError = { api: ApiErrorLike } | { key: 'load' | 'bind' | 'bindNetwork' };

/** `ready` only after a successful read of the lists; a failed read blocks binding. */
type LoadState = 'loading' | 'ready' | 'failed';

/** The failure of a read: the API's own error when it sent one, else the generic load message. */
function loadFailure(json: unknown): ListError {
  const api = toApiErrorLike(json);
  return api.error || api.code ? { api } : { key: 'load' };
}

export interface PointBuyListManagerViewProps {
  loadState: LoadState;
  versions: PointBuyListVersion[];
  selectedId: string;
  currentListId: string | null;
  saving: boolean;
  saved: boolean;
  error: ListError | null;
  onSelect: (id: string) => void;
  onBind: () => void;
  onRetry: () => void;
}

/** The manager without its data flow; a failed read keeps the select and Bind off until Retry works. */
export function PointBuyListManagerView({
  loadState,
  versions,
  selectedId,
  currentListId,
  saving,
  saved,
  error,
  onSelect,
  onBind,
  onRetry,
}: PointBuyListManagerViewProps) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons, errorsDraft);

  if (loadState === 'loading') {
    return <p className="text-sm text-poke-text-secondary">{t('listManager.loading')}</p>;
  }

  const failed = loadState === 'failed';
  const errorText = error ? ('api' in error ? apiErrorText(error.api) : t(`listManager.errors.${error.key}`)) : null;

  return (
    <div className="space-y-4">
      {errorText && <Alert variant="error">{errorText}</Alert>}
      {saved && <Alert variant="success">{t('listManager.bound')}</Alert>}
      {failed && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-poke-text-secondary">{t('listManager.blocked')}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('listManager.retry')}
          </Button>
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-poke-text-secondary">
            {t('listManager.versionLabel')}
          </label>
          <select
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            disabled={failed}
            className="w-full rounded-lg border border-poke-border bg-poke-elevated px-3 py-2 text-sm text-poke-text focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">{t('listManager.selectList')}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {t(v.is_active ? 'listManager.optionActive' : 'listManager.optionInactive', {
                  name: v.name,
                  version: String(v.version),
                })}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={onBind} disabled={failed || saving || !selectedId}>
          {saving ? t('listManager.binding') : t('listManager.bind')}
        </Button>
      </div>

      {!failed && versions.length === 0 && (
        <p className="text-sm text-poke-text-secondary">{t('listManager.empty')}</p>
      )}

      {currentListId && (
        <p className="text-xs text-poke-text-secondary">
          {t('listManager.currentlyBound', {
            name: versions.find((v) => v.id === currentListId)?.name ?? currentListId,
          })}
        </p>
      )}
    </div>
  );
}

export default function PointBuyListManager({ seasonId, currentListId }: PointBuyListManagerProps) {
  const [versions, setVersions] = useState<PointBuyListVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>(currentListId ?? '');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ListError | null>(null);
  const [saved, setSaved] = useState(false);

  // Loads on mount and on Retry only: picking a version must not refetch the lists.
  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch('/api/point-buy-lists');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const data = json.data as PointBuyListVersion[];
        setVersions(data);
        setError(null);
        if (data.length > 0) {
          const active = data.find((v) => v.is_active);
          setSelectedId((current) => current || (active?.id ?? data[0].id));
        }
        setLoadState('ready');
      } else {
        setError(json.success ? { key: 'load' } : loadFailure(json));
        setLoadState('failed');
      }
    } catch {
      setError({ key: 'load' });
      setLoadState('failed');
    }
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleRetry = () => {
    setError(null);
    setLoadState('loading');
    fetchVersions();
  };

  const handleBind = async () => {
    // Without a successful read the select holds nothing the admin chose from.
    if (loadState !== 'ready' || !selectedId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Bind season to selected list version via the seasons API
      const res = await fetch(`/api/seasons/${seasonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point_buy_list_id: selectedId }),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
      } else {
        const api = toApiErrorLike(json);
        setError(api.error || api.code ? { api } : { key: 'bind' });
      }
    } catch {
      setError({ key: 'bindNetwork' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PointBuyListManagerView
      loadState={loadState}
      versions={versions}
      selectedId={selectedId}
      currentListId={currentListId}
      saving={saving}
      saved={saved}
      error={error}
      onSelect={setSelectedId}
      onBind={handleBind}
      onRetry={handleRetry}
    />
  );
}
