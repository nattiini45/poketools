'use client';

import { useEffect, useRef } from 'react';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import SpriteStyleOptions from '@/components/shared/SpriteStyleOptions';
import { useSpriteStyleChange } from '@/components/shared/sprite-style-client';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { spriteStyleMessages } from '@/i18n/messages/sprite-style';
import type { SpriteStylePreference } from '@/lib/pkmn/sprite-styles';

/**
 * The "Sprite style" settings card. A choice applies at once (every sprite on
 * the page re-renders) and is saved to the account and this browser's cookie;
 * a failed save reverts the choice and says so.
 *
 * `stored` is `players.sprite_style`. When it differs from this browser's
 * cookie (a new browser, or a choice made signed out), the account value wins:
 * it is applied and written back to the cookie once on mount.
 */
export default function SpriteStyleSettingsForm({
  stored,
  readFailed,
}: {
  stored: SpriteStylePreference | null;
  readFailed: boolean;
}) {
  const t = useT(spriteStyleMessages);
  const errorText = useApiErrorText();
  const { preference, pending, failed, saved, change } = useSpriteStyleChange();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current || readFailed || stored === null) return;
    synced.current = true;
    if (stored !== preference) void change(stored, { silent: true });
  }, [stored, readFailed, preference, change]);

  return (
    <Card padding="lg">
      <h2 className="text-lg font-heading font-bold text-poke-text-primary mb-1">{t('settings.heading')}</h2>
      <p className="text-sm text-poke-text-secondary mb-4">{t('settings.descriptionSignedIn')}</p>
      {readFailed && (
        <Alert variant="warning" className="mb-4">
          {t('staleRead')}
        </Alert>
      )}
      <SpriteStyleOptions
        name="sprite-style-settings"
        variant="cards"
        legendClassName="sr-only"
        value={preference}
        onChange={(next) => void change(next)}
      />
      <p aria-live="polite" className="min-h-5 pt-2 text-xs text-poke-text-muted">
        {pending ? t('saving') : saved ? t('saved') : ''}
      </p>
      {failed && (
        <Alert variant="error" className="mt-2">
          {failed.code ? errorText(failed) : t('saveFailed')}
        </Alert>
      )}
    </Card>
  );
}
