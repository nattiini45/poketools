import { NextResponse } from 'next/server';
import { isSuperadminNow } from '@/lib/auth/helpers';
import { resolveSuperadminPlayerId } from '@/lib/auth/superadmin';
import type { ApiResult } from '@/types/api';

/**
 * Whether `playerId` is the superadmin's own player row (the player linked to
 * `SUPERADMIN_DISCORD_ID`), read live; a failed read throws. Path ids are
 * accepted in any letter case (Postgres compares uuids as values), so the
 * comparison is case-insensitive.
 */
export async function isSuperadminPlayerRow(playerId: string): Promise<boolean> {
  const superadminPlayerId = await resolveSuperadminPlayerId();
  return !!superadminPlayerId && superadminPlayerId.toLowerCase() === playerId.toLowerCase();
}

/**
 * The 403 a caller gets when they are not the superadmin and target the
 * superadmin's player row; null when the request may go on. Both the row and
 * the caller are read live, and a failed read throws so the request fails
 * closed. Call it right after the caller's `require*` guard, before any read or
 * write of the target.
 */
export async function superadminPlayerProtectedResponse(
  targetPlayerId: string
): Promise<NextResponse<ApiResult<never>> | null> {
  if (!(await isSuperadminPlayerRow(targetPlayerId))) return null;
  if (await isSuperadminNow()) return null;
  return superadminPlayerProtectedBody();
}

/** The refusal body shared by every route that protects the superadmin's player row. */
export function superadminPlayerProtectedBody(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: "Only the superadmin can change the superadmin's player",
      code: 'superadmin_player_protected',
    },
    { status: 403 }
  );
}
