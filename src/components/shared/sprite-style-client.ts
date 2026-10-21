'use client';

import { useCallback, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { isSpriteStylePreference, type SpriteStylePreference } from '@/lib/pkmn/sprite-styles';
import { useSpriteStylePreference } from './SpriteStyleProvider';

/**
 * Client side of `POST /api/sprite-style` (docs/pkmn.md, "Sprite styles"):
 * the only writer of the `plc_sprite_style` cookie and, for a signed-in
 * player, of `players.sprite_style`.
 */

interface SpriteStyleResponseBody {
  success?: boolean;
  error?: string;
  code?: string;
  params?: Record<string, string | number>;
  data?: { style?: string; persisted?: boolean; stored?: unknown };
}

function isBody(v: unknown): v is SpriteStyleResponseBody {
  return typeof v === 'object' && v !== null;
}

export type SpriteStyleSaveResult = { ok: true; persisted: boolean } | { ok: false; error: ApiErrorLike };

export async function saveSpriteStylePreference(style: SpriteStylePreference): Promise<SpriteStyleSaveResult> {
  let res: Response;
  try {
    res = await fetch('/api/sprite-style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style }),
    });
  } catch (err) {
    console.error('[sprite-style] save request failed:', err);
    return { ok: false, error: { code: 'network_error' } };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !isBody(body) || body.success !== true) {
    const error: ApiErrorLike = isBody(body)
      ? { error: body.error ?? null, code: body.code ?? null, params: body.params ?? null }
      : { error: `HTTP ${res.status}` };
    console.error('[sprite-style] save refused:', res.status, error);
    return { ok: false, error };
  }
  return { ok: true, persisted: body.data?.persisted === true };
}

/**
 * GET /api/sprite-style: the signed-in player's stored preference, or null for
 * no account value (anonymous, no player row). `{ ok: false }` on any failure
 * (logged): the caller keeps the cookie value and tries again on a later load.
 */
export async function loadStoredSpriteStylePreference(): Promise<
  { ok: true; stored: SpriteStylePreference | null } | { ok: false }
> {
  let res: Response;
  try {
    res = await fetch('/api/sprite-style', { method: 'GET', cache: 'no-store' });
  } catch (err) {
    console.error('[sprite-style] load request failed:', err);
    return { ok: false };
  }
  const body: unknown = await res.json().catch(() => null);
  const stored = isBody(body) ? body.data?.stored : undefined;
  if (!res.ok || !isBody(body) || body.success !== true || !(stored === null || isSpriteStylePreference(stored))) {
    console.error('[sprite-style] load refused:', res.status, isBody(body) ? body.code ?? body.error : null);
    return { ok: false };
  }
  return { ok: true, stored };
}

/**
 * Applies a choice at once (every sprite re-renders from the provider), saves
 * it, and reverts to the previous choice when the save fails, so the control
 * never shows a selection that is not stored.
 */
export function useSpriteStyleChange(): {
  preference: SpriteStylePreference;
  pending: boolean;
  failed: ApiErrorLike | null;
  saved: boolean;
  /** `silent`: a background re-sync, no "saved" notice. */
  change: (next: SpriteStylePreference, options?: { silent?: boolean }) => Promise<boolean>;
} {
  const { preference, setPreference } = useSpriteStylePreference();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<ApiErrorLike | null>(null);
  const [saved, setSaved] = useState(false);

  const change = useCallback(
    async (next: SpriteStylePreference, options: { silent?: boolean } = {}): Promise<boolean> => {
      const previous = preference;
      setFailed(null);
      setSaved(false);
      setPending(true);
      setPreference(next);
      const result = await saveSpriteStylePreference(next);
      setPending(false);
      if (!result.ok) {
        setPreference(previous);
        setFailed(result.error);
        return false;
      }
      if (!options.silent) setSaved(true);
      return true;
    },
    [preference, setPreference],
  );

  return { preference, pending, failed, saved, change };
}
