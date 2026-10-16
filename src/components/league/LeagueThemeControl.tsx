'use client';

import { useMemo, useState } from 'react';
import Select from '@/components/ui/Select';
import type { RouteThemeId } from '@/types/season';
import type { ApiResult } from '@/types/api';
import { getRouteThemeOptions } from '@/lib/worlds/route-theme-options';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

interface LeagueThemeControlProps {
  seasonId: string;
  /** The league's persisted theme; undefined/'auto' both mean format default. */
  currentTheme?: RouteThemeId;
}

const THEME_OPTIONS = getRouteThemeOptions();

/**
 * Post-create 3D world theme picker for league admins. PATCHes ONLY
 * `{ route_theme }` to /api/seasons/[id] (requireResourceAdmin-guarded,
 * seasonUpdateSchema-validated). Optimistic select with revert-on-failure and
 * an inline error — mirrors EditableDescription's saving/error pattern.
 */
export default function LeagueThemeControl({ seasonId, currentTheme }: LeagueThemeControlProps) {
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [theme, setTheme] = useState<RouteThemeId>(currentTheme ?? 'auto');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const options = useMemo(
    () => THEME_OPTIONS.map((o) => (o.value === 'auto' ? { ...o, label: t('theme.auto') } : o)),
    [t],
  );

  async function handleChange(nextTheme: RouteThemeId) {
    if (nextTheme === theme || saving) return;

    const previous = theme;
    setTheme(nextTheme);
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/seasons/${seasonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_theme: nextTheme }),
      });
      const data: ApiResult<unknown> = await res.json();
      if (!data.success) {
        setTheme(previous);
        setError(data);
      }
    } catch (err) {
      setTheme(previous);
      setError(toApiErrorLike(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xs space-y-2">
      <Select
        label={t('theme.label')}
        value={theme}
        onChange={(e) => handleChange(e.target.value as RouteThemeId)}
        options={options}
        disabled={saving}
      />
      {saving && <p className="text-xs text-poke-text-muted">{t('theme.saving')}</p>}
      {error && (
        <p className="text-xs text-poke-danger">
          {error.error || error.code ? errorText(error) : t('theme.saveFailed')}
        </p>
      )}
    </div>
  );
}
