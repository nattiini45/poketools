'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ResourceAdminWithPlayer, AdminResourceType } from '@/types/resource-admin';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { uiMessages } from '@/i18n/messages/ui';
import Alert from '@/components/ui/Alert';
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox';
import {
  PLAYER_SEARCH_MIN_QUERY,
  PLAYER_SEARCH_NETWORK_ERROR,
  parsePlayerSearch,
  playerSearchUrl,
  type PlayerSearchHit,
} from '@/lib/players/player-search';

interface ResourceAdminManagerProps {
  resourceType: AdminResourceType;
  resourceId: string;
}

export default function ResourceAdminManager({
  resourceType,
  resourceId,
}: ResourceAdminManagerProps) {
  const t = useT(uiMessages);
  const errorText = useApiErrorText();
  const [admins, setAdmins] = useState<ResourceAdminWithPlayer[]>([]);
  const [selected, setSelected] = useState<PlayerSearchHit | null>(null);
  const [searchError, setSearchError] = useState<ApiErrorLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Hits seen in the picker, to turn a picked id back into a name. */
  const seenHits = useRef(new Map<string, PlayerSearchHit>());

  const fetchAdmins = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/resource-admins?resource_type=${resourceType}&resource_id=${resourceId}`
      );
      const json = await res.json();
      if (json.success) setAdmins(json.data);
    } catch {
      // silently fail
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await fetchAdmins();
      setLoading(false);
    }
    load();
  }, [fetchAdmins]);

  const adminPlayerIds = new Set(admins.map((a) => a.player_id));

  // The picker searches the server (registered accounts only: an admin must be
  // able to sign in) instead of preloading a first page of players, which used
  // to hide everyone past the first 50 names.
  const transformSearch = (json: unknown): ComboboxOption[] => {
    const outcome = parsePlayerSearch(json);
    if (!outcome.ok) {
      setSearchError(outcome.error);
      return [];
    }
    setSearchError(null);
    for (const hit of outcome.hits) seenHits.current.set(hit.id, hit);
    return outcome.hits.map((hit) => ({
      label: hit.name,
      value: hit.id,
      meta: { alreadyAdmin: adminPlayerIds.has(hit.id) },
    }));
  };

  async function handleAdd() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/resource-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: selected.id,
          resource_type: resourceType,
          resource_id: resourceId,
        }),
      });
      if (res.ok) {
        setSelected(null);
        await fetchAdmins();
      }
    } catch {
      // silently fail
    }
    setSaving(false);
  }

  async function handleRemove(playerId: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/resource-admins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: playerId,
          resource_type: resourceType,
          resource_id: resourceId,
        }),
      });
      if (res.ok) {
        await fetchAdmins();
      }
    } catch {
      // silently fail
    }
    setSaving(false);
  }

  if (loading) {
    return <p className="text-sm text-poke-text-secondary">{t('resourceAdmins.loading')}</p>;
  }

  const scope = resourceType === 'season' ? { seasonId: resourceId } : { tournamentId: resourceId };

  return (
    <div className="space-y-3">
      {admins.length === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('resourceAdmins.none')}</p>
      ) : (
        <ul className="space-y-2">
          {admins.map((admin) => (
            <li
              key={admin.id}
              className="flex items-center justify-between p-2 border border-poke-border rounded text-sm"
            >
              <span>{admin.player_name}</span>
              <button
                onClick={() => handleRemove(admin.player_id)}
                disabled={saving}
                className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
              >
                {t('resourceAdmins.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Combobox
          mode="async"
          className="flex-1"
          value={selected?.name ?? ''}
          onChange={(id) => {
            const hit = id ? seenHits.current.get(id) ?? null : null;
            setSelected(hit && !adminPlayerIds.has(hit.id) ? hit : null);
          }}
          placeholder={t('resourceAdmins.searchPlaceholder')}
          fetchUrl={playerSearchUrl(scope, { registeredOnly: true })}
          transformResults={transformSearch}
          onFetchError={() => setSearchError(PLAYER_SEARCH_NETWORK_ERROR)}
          minQueryLength={PLAYER_SEARCH_MIN_QUERY}
          renderOption={(option) => (
            <span className={option.meta?.alreadyAdmin ? 'flex items-center gap-2 text-poke-text-muted opacity-60' : 'flex items-center gap-2'}>
              <span>{option.label}</span>
              {option.meta?.alreadyAdmin ? <span className="text-xs">{t('resourceAdmins.alreadyAdmin')}</span> : null}
            </span>
          )}
        />
        <button
          onClick={handleAdd}
          disabled={!selected || saving}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {t('resourceAdmins.add')}
        </button>
      </div>
      {searchError && <Alert variant="error">{errorText(searchError)}</Alert>}
    </div>
  );
}
