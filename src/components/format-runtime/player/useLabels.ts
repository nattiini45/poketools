'use client';

import { useCallback } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { PlayerRef } from '@/lib/format-engine/runtime/view-types';
import { resolveLText, type LText } from '@/lib/studio-core/ltext';

/** Resolves a bilingual label of the format in the viewer's language (a missing text is an empty string, never a key). */
export function useLText(): (text: LText) => string {
  const locale = useLocale();
  return useCallback((text) => resolveLText(text, { viewer: locale })?.value ?? '', [locale]);
}

/** The name of a player, "former player" when the league has no public name for them. Never an id. */
export function usePlayerName(): (player: PlayerRef) => string {
  const t = useT(formatRuntimePlayerMessages);
  return useCallback((player) => player.name ?? t('player.former'), [t]);
}
