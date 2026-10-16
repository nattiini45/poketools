'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ResourceAdminWithPlayer, AdminResourceType } from '@/types/resource-admin';
import type { Player } from '@/types/player';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface ResourceAdminManagerProps {
  resourceType: AdminResourceType;
  resourceId: string;
}

export default function ResourceAdminManager({
  resourceType,
  resourceId,
}: ResourceAdminManagerProps) {
  const t = useT(uiMessages);
  const [admins, setAdmins] = useState<ResourceAdminWithPlayer[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      await Promise.all([
        fetchAdmins(),
        fetch('/api/players')
          .then((r) => r.json())
          .then((json) => {
            if (json.success) setPlayers(json.data);
          })
          .catch(() => {}),
      ]);
      setLoading(false);
    }
    load();
  }, [fetchAdmins]);

  const adminPlayerIds = new Set(admins.map((a) => a.player_id));
  const availablePlayers = players.filter(
    (p) => !adminPlayerIds.has(p.id) && !p.is_admin
  );

  async function handleAdd() {
    if (!selectedPlayerId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/resource-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: selectedPlayerId,
          resource_type: resourceType,
          resource_id: resourceId,
        }),
      });
      if (res.ok) {
        setSelectedPlayerId('');
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

      {availablePlayers.length > 0 && (
        <div className="flex gap-2">
          <select
            value={selectedPlayerId}
            onChange={(e) => setSelectedPlayerId(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-poke-elevated border border-poke-border rounded text-sm text-poke-text-primary"
          >
            <option value="">{t('resourceAdmins.selectPlayer')}</option>
            {availablePlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedPlayerId || saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {t('resourceAdmins.add')}
          </button>
        </div>
      )}
    </div>
  );
}
