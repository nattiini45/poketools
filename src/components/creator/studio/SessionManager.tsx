'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { CastSession } from '@/types/cast-session';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsBroadcast } from '@/i18n/messages/errors';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';

/**
 * Name stored for an unnamed session (mirrors UNTITLED_CAST_SESSION_NAME in
 * the server-only cast-sessions query). Legacy and new rows both carry it.
 */
const UNTITLED_SESSION_SENTINEL = 'Untitled Session';

/** A failure to show: the API's error when it sent one, else the local fallback message. */
interface SessionError {
  res: ApiErrorLike | null;
  fallback: 'loadFailed' | 'createFailed' | 'createFailedRetry';
}

function hasApiText(res: ApiErrorLike | null): res is ApiErrorLike {
  return Boolean(res && (res.error || res.code));
}

const MODE_CARDS = [
  { mode: 'cast', key: 'livecast' },
  { mode: 'replaycast', key: 'replaycast' },
  { mode: 'solo', key: 'solo' },
] as const;

/**
 * SessionManager — session list + create new session.
 * Shown at /creator/studio when no sessionId is selected.
 */
export default function SessionManager() {
  const router = useRouter();
  const t = useT(creatorStudioMessages);
  const formatter = useFormatter();
  const errorText = useApiErrorText(errorsBroadcast);
  const [sessions, setSessions] = useState<CastSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  /** Stored English placeholders ('Me'/'Opponent') read in the viewer's language; real names pass through. */
  const displayName = (name: string): string => {
    const placeholder = soloPlaceholderOf(name);
    if (placeholder === 'me') return t('solo.me');
    if (placeholder === 'opponent') return t('solo.opponent');
    return name;
  };

  useEffect(() => {
    fetch('/api/cast-sessions')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setSessions(res.data);
        else setError({ res: toApiErrorLike(res), fallback: 'loadFailed' });
      })
      .catch(() => setError({ res: null, fallback: 'loadFailed' }))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = useCallback(async (mode: 'cast' | 'solo' | 'replaycast') => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/cast-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (json.success) {
        const path = mode === 'solo'
          ? `/creator/studio/${json.data.id}/solo`
          : `/creator/studio/${json.data.id}`;
        router.push(path);
      } else {
        setError({ res: toApiErrorLike(json), fallback: 'createFailed' });
      }
    } catch {
      setError({ res: null, fallback: 'createFailedRetry' });
    } finally {
      setCreating(false);
    }
  }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/cast-sessions/${id}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  if (loading) {
    return (
      <div className="py-12 text-center text-body text-fg-muted animate-pulse">
        {t('sessions.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create new session */}
      <section aria-labelledby="studio-new">
        <AdminSectionHeading id="studio-new" icon="poke-ball" title={t('sessions.newTitle')} />
        {error && (
          <Alert variant="error" className="mb-4 text-loss">
            {hasApiText(error.res) ? errorText(error.res) : t(`sessions.${error.fallback}`)}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {MODE_CARDS.map(({ mode, key }) => (
            <button
              key={mode}
              onClick={() => handleCreate(mode)}
              disabled={creating}
              className="rounded-poke-lg border border-hairline bg-surface p-4 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50"
            >
              <h3 className="font-heading text-subtitle text-fg">{t(`sessions.${key}.title`)}</h3>
              <p className="mt-1 text-caption text-fg-muted">
                {t(`sessions.${key}.description`)}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Existing sessions */}
      {sessions.length > 0 && (
        <section aria-labelledby="studio-recent">
          <AdminSectionHeading id="studio-recent" icon="poke-doll" title={t('sessions.recentTitle')} />
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-poke-lg border border-hairline bg-surface px-4 py-3 transition-colors hover:bg-hover"
              >
                <button
                  onClick={() => router.push(
                    s.mode === 'solo'
                      ? `/creator/studio/${s.id}/solo`
                      : `/creator/studio/${s.id}`,
                  )}
                  className="min-w-0 flex-1 basis-60 text-left focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-heading text-subtitle text-fg">
                      {!s.name || s.name === UNTITLED_SESSION_SENTINEL ? t('sessions.untitled') : s.name}
                    </span>
                    <SkewChip>{t.dynamic(`mode.${s.mode}`, undefined, s.mode)}</SkewChip>
                    <SkewChip tone={s.status === 'live' ? 'live' : s.status === 'archived' ? 'neutral' : 'accent'}>
                      {t.dynamic(`status.${s.status}`, undefined, s.status)}
                    </SkewChip>
                  </div>
                  <p className="mt-1 text-caption text-fg-muted">
                    {s.player1_name && s.player2_name
                      ? t('sessions.matchup', { player1: displayName(s.player1_name), player2: displayName(s.player2_name) })
                      : t('sessions.noMatch')}
                    {' '}
                    {t('sessions.updated', { date: formatter.instant(s.updated_at, 'date') })}
                  </p>
                </button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}>
                  {t('sessions.delete')}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
