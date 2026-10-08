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
      <div className="text-center py-12 text-poke-text-secondary animate-pulse">
        {t('sessions.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create new session */}
      <div>
        <h2 className="font-heading text-xl font-bold text-poke-text-primary mb-4">
          {t('sessions.newTitle')}
        </h2>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-poke-md px-4 py-2 text-sm text-poke-danger-tint-ink mb-4">
            {hasApiText(error.res) ? errorText(error.res) : t(`sessions.${error.fallback}`)}
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          {MODE_CARDS.map(({ mode, key }) => (
            <button
              key={mode}
              onClick={() => handleCreate(mode)}
              disabled={creating}
              className="rounded-poke-lg bg-poke-surface border border-poke-border p-4 text-left hover:border-poke-accent transition-colors disabled:opacity-50"
            >
              <h3 className="font-heading font-bold text-poke-text-primary">{t(`sessions.${key}.title`)}</h3>
              <p className="text-xs text-poke-text-secondary mt-1">
                {t(`sessions.${key}.description`)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Existing sessions */}
      {sessions.length > 0 && (
        <div>
          <h2 className="font-heading text-xl font-bold text-poke-text-primary mb-4">
            {t('sessions.recentTitle')}
          </h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-poke-md bg-poke-surface border border-poke-border px-4 py-3 hover:border-poke-accent/50 transition-colors"
              >
                <button
                  onClick={() => router.push(
                    s.mode === 'solo'
                      ? `/creator/studio/${s.id}/solo`
                      : `/creator/studio/${s.id}`,
                  )}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-heading font-bold text-poke-text-primary">
                      {!s.name || s.name === UNTITLED_SESSION_SENTINEL ? t('sessions.untitled') : s.name}
                    </span>
                    <span className="rounded-full bg-poke-muted px-2 py-0.5 text-xs font-heading uppercase text-poke-text-secondary">
                      {t.dynamic(`mode.${s.mode}`, undefined, s.mode)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-heading uppercase ${
                      s.status === 'live' ? 'bg-red-500/20 text-poke-danger-tint-ink' :
                      s.status === 'archived' ? 'bg-poke-muted text-poke-text-secondary' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {t.dynamic(`status.${s.status}`, undefined, s.status)}
                    </span>
                  </div>
                  <p className="text-xs text-poke-text-secondary mt-1">
                    {s.player1_name && s.player2_name
                      ? t('sessions.matchup', { player1: displayName(s.player1_name), player2: displayName(s.player2_name) })
                      : t('sessions.noMatch')}
                    {' '}
                    {t('sessions.updated', { date: formatter.instant(s.updated_at, 'date') })}
                  </p>
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="ml-4 text-xs text-poke-text-secondary hover:text-poke-danger-tint-ink transition-colors"
                >
                  {t('sessions.delete')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
