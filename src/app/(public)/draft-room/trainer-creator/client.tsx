'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  DEFAULT_TRAINER_CONFIG,
  SKIN_TONES,
  HAIR_COLORS,
  OUTFIT_COLORS,
  HAIR_STYLE_IDS,
  HAT_STYLE_IDS,
  type TrainerConfig,
} from '@/lib/draft-room/trainer-config';
import { useT } from '@/i18n/client';
import { trainerCreatorMessages } from '@/i18n/messages/trainer-creator';

const TrainerPreview = dynamic(() => import('./preview'), { ssr: false });

const TEAM_ACCENT_COLORS = ['#a855f7', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f8fafc'];

interface Props {
  playerId: string;
}

function ColorSwatches({
  colors,
  value,
  onChange,
  label,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-poke-text-muted mb-1 block">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`w-7 h-7 rounded-full border-2 transition-transform ${
              value === c ? 'border-poke-surface scale-110' : 'border-transparent hover:scale-105'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

/** `options` are already-translated labels, in preset-index order. */
function OptionButtons({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: string; label: string }[];
  value: number;
  onChange: (i: number) => void;
  label: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-poke-text-muted mb-1 block">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {options.map((option, i) => (
          <button
            key={option.id}
            onClick={() => onChange(i)}
            className={`px-3 py-1 text-xs rounded-md border transition-colors ${
              value === i
                ? 'bg-poke-accent border-poke-accent text-poke-surface'
                : 'border-poke-border text-poke-text-secondary hover:border-poke-accent'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TrainerCreatorClient({ playerId }: Props) {
  const t = useT(trainerCreatorMessages);
  const [config, setConfig] = useState<TrainerConfig>(DEFAULT_TRAINER_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hairStyles = HAIR_STYLE_IDS.map((id) => ({ id, label: t(`hairStyles.${id}`) }));
  const hatStyles = HAT_STYLE_IDS.map((id) => ({ id, label: t(`hatStyles.${id}`) }));

  const update = useCallback(<K extends keyof TrainerConfig>(key: K, val: TrainerConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/avatar/3d', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, config }),
      });
      if (res.ok) setSaved(true);
    } catch {
      // handled by UI state
    } finally {
      setSaving(false);
    }
  }, [playerId, config]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 3D Preview */}
      <div className="rounded-xl border border-poke-border overflow-hidden bg-poke-elevated h-[400px] lg:h-[500px]">
        <TrainerPreview config={config} />
      </div>

      {/* Controls */}
      <div className="space-y-5">
        <ColorSwatches
          label={t('fields.skinTone')}
          colors={SKIN_TONES}
          value={config.skinTone}
          onChange={(c) => update('skinTone', c)}
        />
        <OptionButtons
          label={t('fields.hairStyle')}
          options={hairStyles}
          value={config.hairStyle}
          onChange={(i) => update('hairStyle', i)}
        />
        <ColorSwatches
          label={t('fields.hairColor')}
          colors={HAIR_COLORS}
          value={config.hairColor}
          onChange={(c) => update('hairColor', c)}
        />
        <ColorSwatches
          label={t('fields.outfitColor')}
          colors={OUTFIT_COLORS}
          value={config.outfitColor}
          onChange={(c) => update('outfitColor', c)}
        />
        <ColorSwatches
          label={t('fields.pantsColor')}
          colors={OUTFIT_COLORS}
          value={config.pantsColor}
          onChange={(c) => update('pantsColor', c)}
        />
        <OptionButtons
          label={t('fields.hat')}
          options={hatStyles}
          value={config.hatStyle}
          onChange={(i) => update('hatStyle', i)}
        />
        {config.hatStyle > 0 && (
          <ColorSwatches
            label={t('fields.hatColor')}
            colors={OUTFIT_COLORS}
            value={config.hatColor}
            onChange={(c) => update('hatColor', c)}
          />
        )}
        <ColorSwatches
          label={t('fields.teamAccent')}
          colors={TEAM_ACCENT_COLORS}
          value={config.teamColor}
          onChange={(c) => update('teamColor', c)}
        />

        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-poke-accent hover:bg-poke-accent-strong disabled:opacity-50 text-poke-surface font-medium rounded-lg transition-colors"
          >
            {saving ? t('saving') : t('save')}
          </button>
          {saved && (
            <span className="text-sm text-green-400">{t('saved')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
