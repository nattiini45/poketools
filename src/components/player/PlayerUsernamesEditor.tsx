'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { useRefreshSessionPlayer } from '@/components/shared/SessionProvider';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { accountMessages } from '@/i18n/messages/account';
import { errorsPlayers } from '@/i18n/messages/errors';

interface PlayerUsernamesEditorProps {
  playerId: string;
  initialPlayer: Player | null;
}

/** The outcome of the last save: success, or the API's error (never translated text). */
type SaveMessage = { type: 'success' } | { type: 'error'; error: ApiErrorLike | null };

export default function PlayerUsernamesEditor({ playerId, initialPlayer }: PlayerUsernamesEditorProps) {
  const router = useRouter();
  const refreshSessionPlayer = useRefreshSessionPlayer();
  const t = useT(accountMessages);
  const errorText = useApiErrorText(errorsPlayers);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  const [psUsername, setPsUsername] = useState(initialPlayer?.ps_username || '');
  const [championsUsername, setChampionsUsername] = useState(initialPlayer?.champions_username || '');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ps_username: psUsername.trim() || null,
          champions_username: championsUsername.trim() || null,
        }),
      });

      const result = (await response.json()) as ApiResult<Player>;

      if (!response.ok || !result.success) {
        const apiError = result.success ? null : toApiErrorLike(result);
        setMessage({ type: 'error', error: apiError?.error || apiError?.code ? apiError : null });
        return;
      }

      setMessage({ type: 'success' });
      // Re-read the session player before the refresh, or server renders keep
      // the old usernames for up to the 5-minute session TTL (D37). Bounded:
      // a stalled refresh resolves false after
      // SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS, so the button cannot stay busy.
      await refreshSessionPlayer();
      router.refresh();
    } catch (err) {
      const apiError = toApiErrorLike(err);
      setMessage({ type: 'error', error: apiError.error || apiError.code ? apiError : null });
    } finally {
      setIsLoading(false);
    }
  }, [championsUsername, playerId, psUsername, refreshSessionPlayer, router]);

  const messageText =
    message === null
      ? null
      : message.type === 'success'
        ? t('usernames.saved')
        : message.error
          ? errorText(message.error)
          : t('usernames.failed');

  return (
    <Card variant="outlined" padding="lg" className="h-full">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-heading font-bold text-poke-text-primary">
          {t('usernames.title')}
        </h2>
        <Badge variant="blue" size="sm">{t('usernames.edit')}</Badge>
      </div>

      <p className="text-sm text-poke-text-muted mb-4">
        {t('usernames.intro')}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-1.5">
            {t('usernames.showdown')}
          </label>
          <Input
            type="text"
            value={psUsername}
            onChange={(e) => setPsUsername(e.target.value)}
            placeholder={t('usernames.showdownPlaceholder')}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-1.5">
            {t('usernames.champions')}
          </label>
          <Input
            type="text"
            value={championsUsername}
            onChange={(e) => setChampionsUsername(e.target.value)}
            placeholder={t('usernames.championsPlaceholder')}
            className="w-full"
          />
        </div>

        {message && messageText && (
          <div className={`text-sm px-3 py-2 rounded-poke-md ${
            message.type === 'success'
              ? 'bg-poke-green-light text-poke-green'
              : 'bg-poke-accent-light text-poke-accent'
          }`}>
            {messageText}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={isLoading}
        >
          {t('usernames.save')}
        </Button>
      </form>
    </Card>
  );
}
