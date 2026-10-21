'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DraftTierLimit, PowerTier } from '@/types/evolution';
import { POWER_TIERS, POWER_TIER_COLORS } from '@/types/evolution';
import { formatPack } from '@/lib/format-pack';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft, errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { draftLegacyLeagueAdminMessages } from '@/i18n/messages/draft/legacy/league-admin';
import { draftLegacyLeagueAdminPoolMessages } from '@/i18n/messages/draft/legacy/league-admin/pool';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { tierLimitsDirty } from '@/lib/league-admin/form-dirty';

interface DraftTierLimitsEditorProps {
  seasonId: string;
}

/** A failed save keeps the API body; a network failure keeps a message key. */
type LimitsError = { api: ApiErrorLike } | { key: 'load' | 'save' };

export default function DraftTierLimitsEditor({ seasonId }: DraftTierLimitsEditorProps) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const tShared = useT(draftLegacyLeagueAdminMessages);
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons, errorsDraft);
  const [limits, setLimits] = useState<Record<PowerTier, number>>(() => ({
    ...formatPack.draftFormat.tierLimitDefaults,
  }));
  /** The limits last loaded or saved: edits that differ are unsaved (league admin tab guard). */
  const [savedLimits, setSavedLimits] = useState<Record<PowerTier, number>>(limits);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LimitsError | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchLimits = useCallback(async () => {
    try {
      const res = await fetch(`/api/draft-tier-limits?season_id=${seasonId}`);
      const json = await res.json();
      if (json.success) {
        const fetched: Record<PowerTier, number> = { S: 0, A: 0, B: 0, C: 0 };
        for (const limit of json.data as DraftTierLimit[]) {
          fetched[limit.power_tier] = limit.max_picks;
        }
        setLimits(fetched);
        setSavedLimits(fetched);
      } else {
        setError({ api: toApiErrorLike(json) });
      }
    } catch {
      setError({ key: 'load' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchLimits();
  }, [fetchLimits]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const submitted = limits;

    try {
      const limitsArray = POWER_TIERS.map((pt) => ({
        power_tier: pt,
        max_picks: limits[pt],
      }));

      const res = await fetch('/api/draft-tier-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season_id: seasonId, limits: limitsArray }),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      setSavedLimits(submitted);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError({ key: 'save' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-poke-text-muted">{t('tierLimits.loading')}</p>;

  const errorText = error ? ('api' in error ? apiErrorText(error.api) : t(`tierLimits.errors.${error.key}`)) : null;

  return (
    <div className="space-y-3" {...unsavedMarker(tierLimitsDirty(savedLimits, limits))}>
      <p className="text-xs text-poke-text-muted">{t('tierLimits.intro')}</p>

      {errorText && <Alert variant="error">{errorText}</Alert>}
      {saved && <Alert variant="success">{t('tierLimits.saved')}</Alert>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {POWER_TIERS.map((pt) => {
          const colors = POWER_TIER_COLORS[pt];
          return (
            <div key={pt} className={`p-3 rounded-poke-md border ${colors.border} ${colors.bg}`}>
              <label className={`block text-sm font-heading font-bold ${colors.text} mb-1`}>
                {tShared('tier', { tier: pt })}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={limits[pt]}
                  onChange={(e) => setLimits({ ...limits, [pt]: Number(e.target.value) })}
                  className="w-16 border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary text-center focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                />
                <span className="text-xs text-poke-text-muted">
                  {limits[pt] === 0 ? t('tierLimits.unlimited') : t('tierLimits.max', { count: limits[pt] })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
        {t('tierLimits.save')}
      </Button>
    </div>
  );
}
