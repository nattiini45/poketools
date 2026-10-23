'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Section from '@/components/ui/Section';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';
import { useFormatter, useT } from '@/i18n/client';
import { RelativeTime } from '@/i18n/LocalTime';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { auditActionLabel, type ExtensionAuditActionLabels } from '@/i18n/content/audit-actions';

interface AuditLogEntry {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  created_at: string;
}

interface AttentionMatch {
  id: string;
  tournament_id: string;
  tournament_name: string;
  /** The league the tournament is a phase of; null for a standalone tournament. */
  season_name: string | null;
  player_1_name: string;
  player_2_name: string;
  status: MatchStatus;
  created_at: string;
}

/** `null` = not available for the viewer's role (a resource admin has no site-wide totals). */
interface DashboardCounts {
  players: number | null;
  tournaments: number;
  active_matches: number;
  seasons: number;
  games: number | null;
}

export interface DashboardData {
  counts: DashboardCounts;
  attention_required: AttentionMatch[];
  /** Every match needing attention; larger than `attention_required` when truncated. */
  attention_total: number;
  /** null = not available for the viewer's role. */
  recent_activity: AuditLogEntry[] | null;
}

// Re-exported for existing importers; new code imports from `@/i18n/content/audit-actions`.
export { auditActionLabel };

/** A failed load: the API body (translated by code) or a local message key. */
type LoadError = { api: ApiErrorLike } | { local: 'loadFailed' | 'networkError' };

function StatCard({ label, value }: { label: string; value: number }) {
  const formatter = useFormatter();
  return (
    <Card variant="muted" padding="md" className="text-center">
      <p className="text-2xl font-heading font-bold text-poke-text-primary">{formatter.number(value)}</p>
      <p className="text-xs text-poke-text-muted font-heading uppercase tracking-wide mt-1">{label}</p>
    </Card>
  );
}

export default function AdminDashboardContent({
  extensionActionLabels = {},
}: {
  /** Localized labels of the active pack extension's audit actions (`extensionAuditActionLabels`). */
  extensionActionLabels?: ExtensionAuditActionLabels;
} = {}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const t = useT(adminCoreMessages);
  const errorText = useApiErrorText(errorsAdmin);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dashboard');
      const json: ApiResult<DashboardData> = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        const err = toApiErrorLike(json);
        setError(err.error || err.code ? { api: err } : { local: 'loadFailed' });
      }
    } catch {
      setError({ local: 'networkError' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} variant="muted" padding="md" className="text-center animate-pulse">
              <div className="h-8 w-16 bg-poke-elevated rounded mx-auto mb-2" />
              <div className="h-3 w-20 bg-poke-elevated rounded mx-auto" />
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <div className="h-48 bg-poke-surface rounded-poke-lg animate-pulse" />
          <div className="h-64 bg-poke-surface rounded-poke-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-poke-text-muted mb-4">
          {'api' in error ? errorText(error.api) : t(`dashboard.${error.local}`)}
        </p>
        <Button onClick={load}>{t('dashboard.retry')}</Button>
      </div>
    );
  }

  if (!data) return null;

  return <DashboardView data={data} extensionActionLabels={extensionActionLabels} />;
}

/** The loaded dashboard. Exported for tests; `null` figures are hidden (not available for the role). */
export function DashboardView({
  data,
  extensionActionLabels = {},
}: {
  data: DashboardData;
  extensionActionLabels?: ExtensionAuditActionLabels;
}) {
  const t = useT(adminCoreMessages);
  const { counts, attention_required, attention_total, recent_activity } = data;

  const allStatItems = [
    { key: 'players', value: counts.players },
    { key: 'tournaments', value: counts.tournaments },
    { key: 'activeMatches', value: counts.active_matches },
    { key: 'seasons', value: counts.seasons },
    { key: 'games', value: counts.games },
  ] as const;
  // A null figure is not available for this role: hide the card rather than show a zero.
  const statItems = allStatItems.filter(
    (s): s is (typeof allStatItems)[number] & { value: number } => s.value !== null,
  );
  const attentionTruncated = attention_total > attention_required.length;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div
        className={`grid grid-cols-2 md:grid-cols-3 gap-4 ${statItems.length === 5 ? 'lg:grid-cols-5' : ''}`}
      >
        {statItems.map((s) => (
          <StatCard key={s.key} label={t(`dashboard.stats.${s.key}`)} value={s.value} />
        ))}
      </div>

      {/* Attention Required + Recent Activity: side by side on lg */}
      <div
        className={`grid grid-cols-1 gap-6 items-start ${Array.isArray(recent_activity) ? 'lg:grid-cols-2' : ''}`}
      >
        {/* Attention Required */}
        <Section
          title={t('dashboard.attention.title')}
          subtitle={
            attention_required.length > 0
              ? attentionTruncated
                ? t('dashboard.attention.countOfTotal', { count: attention_required.length, total: attention_total })
                : t('dashboard.attention.count', { count: attention_required.length })
              : undefined
          }
        >
          {attention_required.length === 0 ? (
            <p className="text-sm text-poke-text-muted py-2">{t('dashboard.attention.empty')}</p>
          ) : (
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {attention_required.map((m) => (
                <Card key={m.id} variant="outlined" padding="sm" hover>
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/tournaments/${m.tournament_id}/matches/${m.id}`}
                      className="text-sm font-heading font-semibold text-poke-text-primary hover:text-poke-accent transition-colors truncate"
                    >
                      {t('versus', { player1: m.player_1_name, player2: m.player_2_name })}
                    </Link>
                    <Badge
                      variant={m.status === 'disputed' ? 'red' : 'yellow'}
                      size="sm"
                    >
                      {m.status === 'pending_confirmation'
                        ? t('dashboard.attention.needsConfirm')
                        : t('dashboard.attention.disputed')}
                    </Badge>
                  </div>
                  <p className="text-xs text-poke-text-muted mt-1 truncate">{m.season_name
                      ? t('dashboard.attention.leaguePhase', { league: m.season_name, phase: m.tournament_name })
                      : m.tournament_name}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Link href={`/admin/matches/${m.id}`}>
                      <Button variant="secondary" size="sm">{t('dashboard.attention.view')}</Button>
                    </Link>
                    <Link href={`/tournaments/${m.tournament_id}`}>
                      <Button variant="ghost" size="sm">{t('dashboard.attention.tournament')}</Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Recent Activity: site admins only (the audit trail is not scoped) */}
        {Array.isArray(recent_activity) && (
          <Section
            title={t('dashboard.activity.title')}
            subtitle={t('dashboard.activity.count', { count: recent_activity.length })}
            action={(
              <Link href="/admin/audit">
                <Button variant="secondary" size="sm">{t('dashboard.activity.viewAll')}</Button>
              </Link>
            )}
          >
            {recent_activity.length === 0 ? (
              <p className="text-sm text-poke-text-muted py-2">{t('dashboard.activity.empty')}</p>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {recent_activity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-2 rounded-poke-md hover:bg-poke-elevated transition-colors text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-poke-text-primary font-heading font-medium truncate">
                        {entry.actor_name}
                      </p>
                      <p className="text-xs text-poke-text-muted truncate">
                        {auditActionLabel(t, entry.action, extensionActionLabels)}
                        {entry.resource_name && (
                          <span className="text-poke-text-secondary"> — {entry.resource_name}</span>
                        )}
                      </p>
                    </div>
                    <RelativeTime value={entry.created_at} className="text-xs text-poke-text-muted shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
