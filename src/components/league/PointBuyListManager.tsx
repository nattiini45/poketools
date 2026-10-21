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

/** A failed bind keeps the API body; other failures keep a message key. */
type ListError = { api: ApiErrorLike } | { key: 'load' | 'bind' | 'bindNetwork' };

export default function PointBuyListManager({ seasonId, currentListId }: PointBuyListManagerProps) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons, errorsDraft);
  const [versions, setVersions] = useState<PointBuyListVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>(currentListId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ListError | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch('/api/point-buy-lists');
      const json = await res.json();
      if (json.success) {
        setVersions(json.data);
        if (!selectedId && json.data.length > 0) {
          const active = json.data.find((v: PointBuyListVersion) => v.is_active);
          setSelectedId(active?.id ?? json.data[0].id);
        }
      }
    } catch {
      setError({ key: 'load' });
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleBind = async () => {
    if (!selectedId) return;
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

  if (loading) {
    return <p className="text-sm text-poke-text-secondary">{t('listManager.loading')}</p>;
  }

  const errorText = error ? ('api' in error ? apiErrorText(error.api) : t(`listManager.errors.${error.key}`)) : null;

  return (
    <div className="space-y-4">
      {errorText && <Alert variant="error">{errorText}</Alert>}
      {saved && <Alert variant="success">{t('listManager.bound')}</Alert>}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-poke-text-secondary">
            {t('listManager.versionLabel')}
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-poke-border bg-poke-elevated px-3 py-2 text-sm text-poke-text focus:border-blue-500 focus:outline-none"
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
        <Button onClick={handleBind} disabled={saving || !selectedId}>
          {saving ? t('listManager.binding') : t('listManager.bind')}
        </Button>
      </div>

      {versions.length === 0 && (
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
