'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import type { BroadcastPreset, BroadcastPresetConfig } from '@/types/broadcast';
import { OVERLAY_TYPES, type OverlayTypeKey } from '@/lib/broadcast/url-builder';
import { useT } from '@/i18n/client';
import { creatorContentMessages } from '@/i18n/messages/creator/content';

interface PresetManagerProps {
  presets: BroadcastPreset[];
  onLoad: (config: BroadcastPresetConfig, typeKey: OverlayTypeKey | null) => void;
  onDelete: (id: string) => void;
  deleting?: string | null;
}

/** Attempt to map a BroadcastPresetType back to the most likely OverlayTypeKey. */
function presetTypeToOverlayKey(presetType: string): OverlayTypeKey | null {
  for (const [key, def] of Object.entries(OVERLAY_TYPES)) {
    if (def.presetType === presetType) return key as OverlayTypeKey;
  }
  return null;
}

export default function PresetManager({ presets, onLoad, onDelete, deleting }: PresetManagerProps) {
  const t = useT(creatorContentMessages);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (presets.length === 0) {
    return (
      <Card variant="muted">
        <p className="text-sm text-poke-text-secondary">
          {t('presets.empty')}
        </p>
      </Card>
    );
  }

  // Group by preset type
  const grouped = presets.reduce<Record<string, BroadcastPreset[]>>((acc, p) => {
    const key = p.preset_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <Card>
      <h3 className="text-lg font-heading font-bold text-poke-text-primary mb-4">{t('presets.title')}</h3>

      <div className="space-y-4">
        {Object.entries(grouped).map(([type, typePresets]) => (
          <div key={type}>
            <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
              {t.dynamic(`presetType.${type}`, undefined, type)}
            </h4>
            <div className="space-y-2">
              {typePresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between px-3 py-2 rounded-poke-md bg-poke-muted border border-poke-border"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Color swatches */}
                    <div className="flex gap-1 shrink-0">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: preset.config.accent ?? '#EF4444' }}
                      />
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: preset.config.accent2 ?? '#3B82F6' }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-poke-text-primary truncate">
                      {preset.name}
                    </span>
                    {preset.config.theme && (
                      <span className="text-xs text-poke-text-muted shrink-0">
                        {t.dynamic(`theme.${preset.config.theme}`, undefined, preset.config.theme)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLoad(preset.config, presetTypeToOverlayKey(preset.preset_type))}
                    >
                      {t('presets.load')}
                    </Button>

                    {confirmDelete === preset.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            onDelete(preset.id);
                            setConfirmDelete(null);
                          }}
                          loading={deleting === preset.id}
                        >
                          {t('presets.confirm')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t('presets.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(preset.id)}
                        className="text-poke-danger hover:text-poke-danger"
                      >
                        {t('presets.delete')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
