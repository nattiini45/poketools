import type { ReactElement } from 'react';
import { AuthError, requireCreator } from '@/lib/auth/helpers';
import { redirectToSignIn } from '@/lib/auth/redirect-to-sign-in';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

export type CreatorPageGate = { ok: true; playerId: string } | { ok: false; view: ReactElement };

/**
 * The gate of the creator studio pages. A signed-out visitor goes to sign-in and comes back to the studio page; a signed-in
 * player who is not a creator (or is banned or suspended) sees the forbidden panel instead of being bounced to the home
 * page. Only `AuthError` is an access decision: any other failure is rethrown, not turned into a redirect.
 */
export async function gateCreatorPage(): Promise<CreatorPageGate> {
  try {
    const player = await requireCreator();
    return { ok: true, playerId: player.playerId };
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.code === 'unauthenticated') return redirectToSignIn();
    const t = await getT(shellMessages);
    return { ok: false, view: <ResourceForbidden>{t('guards.creatorOnly')}</ResourceForbidden> };
  }
}
