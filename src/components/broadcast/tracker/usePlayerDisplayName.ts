'use client';

import { useCallback } from 'react';
import { useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';

/**
 * Display name for a tracker player. The stored solo placeholders ('Me',
 * 'Opponent') are data and stay English; they are translated here. Real
 * player names are returned unchanged.
 */
export function usePlayerDisplayName(): (name: string) => string {
  const t = useT(broadcastCasterMessages);
  return useCallback(
    (name: string) => {
      const placeholder = soloPlaceholderOf(name);
      if (placeholder === 'me') return t('tracker.placeholderMe');
      if (placeholder === 'opponent') return t('tracker.placeholderOpponent');
      return name;
    },
    [t],
  );
}
