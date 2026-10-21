'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import OverlayUrlBuilder from './OverlayUrlBuilder';
import PresetManager from './PresetManager';
import RecapGenerator from './RecapGenerator';
import MomentsBrowser from './MomentsBrowser';
import type {
  BroadcastPreset,
  BroadcastPresetConfig,
  BroadcastPresetType,
} from '@/types/broadcast';
import type { PublicMatch } from '@/lib/match/public-match';
import type { SeasonWithDetails } from '@/types/season';
import type { DraftPoolWithDetails } from '@/types/draft';
import { OVERLAY_TYPES, type OverlayTypeKey } from '@/lib/broadcast/url-builder';
import { useT } from '@/i18n/client';
import { creatorContentMessages } from '@/i18n/messages/creator/content';

interface ContentDashboardClientProps {
  matches: PublicMatch[];
  seasons: SeasonWithDetails[];
  draftPools: DraftPoolWithDetails[];
  presets: BroadcastPreset[];
  playerId: string;
}

export default function ContentDashboardClient({
  matches,
  seasons,
  draftPools,
  presets: initialPresets,
  playerId: _playerId,
}: ContentDashboardClientProps) {
  const t = useT(creatorContentMessages);
  const [presets, setPresets] = useState(initialPresets);
  const [savingPreset, setSavingPreset] = useState(false);
  const [deletingPreset, setDeletingPreset] = useState<string | null>(null);

  // Ref-based communication: PresetManager calls loadConfig on OverlayUrlBuilder
  // We use a shared state for the "loaded config" to pass down
  const [loadedConfig, setLoadedConfig] = useState<{
    config: BroadcastPresetConfig;
    typeKey: OverlayTypeKey | null;
  } | null>(null);
  const loadedConfigKey = useRef(0);

  const handleSavePreset = useCallback(
    async (name: string, typeKey: OverlayTypeKey, config: BroadcastPresetConfig) => {
      setSavingPreset(true);
      try {
        const typeDef = OVERLAY_TYPES[typeKey];
        const res = await fetch('/api/broadcast/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            preset_type: typeDef.presetType satisfies BroadcastPresetType,
            config,
          }),
        });
        const json = await res.json();
        if (json.success) {
          setPresets((prev) => [json.data, ...prev]);
        }
      } finally {
        setSavingPreset(false);
      }
    },
    []
  );

  const handleDeletePreset = useCallback(async (id: string) => {
    setDeletingPreset(id);
    try {
      const res = await fetch(`/api/broadcast/presets/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setPresets((prev) => prev.filter((p) => p.id !== id));
      }
    } finally {
      setDeletingPreset(null);
    }
  }, []);

  const handleLoadPreset = useCallback(
    (config: BroadcastPresetConfig, typeKey: OverlayTypeKey | null) => {
      loadedConfigKey.current += 1;
      setLoadedConfig({ config, typeKey });
    },
    []
  );

  // Active matches for battle tracker quick link
  const activeMatches = matches.filter(
    (m) => m.status === 'scheduled' || m.status === 'in_progress'
  );

  return (
    <div className="space-y-8">
      {/* Battle Tracker Quick Access */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-heading font-bold text-poke-text-primary">
              {t('dashboard.trackerTitle')}
            </h3>
            <p className="text-sm text-poke-text-secondary mt-1">
              {activeMatches.length > 0
                ? t('dashboard.activeMatches', { count: activeMatches.length })
                : t('dashboard.noActiveMatches')}
            </p>
          </div>
          <Link
            href="/dashboard/broadcast"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-poke-md bg-poke-accent text-poke-surface font-heading font-semibold text-sm hover:bg-poke-accent/90 transition-colors"
          >
            {t('dashboard.openTracker')}
          </Link>
        </div>
      </Card>

      {/* Overlay URL Builder */}
      <OverlayUrlBuilder
        matches={matches}
        seasons={seasons}
        draftPools={draftPools}
        onSavePreset={handleSavePreset}
        savingPreset={savingPreset}
        initialType={loadedConfig?.typeKey ?? undefined}
        initialConfig={loadedConfig?.config}
        key={`builder-${loadedConfigKey.current}`}
      />

      {/* Preset Manager */}
      <PresetManager
        presets={presets}
        onLoad={handleLoadPreset}
        onDelete={handleDeletePreset}
        deleting={deletingPreset}
      />

      {/* Weekly Recap Generator */}
      <RecapGenerator seasons={seasons} />

      {/* Moments Browser */}
      <MomentsBrowser matches={matches} />
    </div>
  );
}
