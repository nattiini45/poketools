import { redirectToSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getSession } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import type { AvatarConfig } from '@/types/avatar';
import AvatarBuilderPage from './AvatarBuilderPage';

export const dynamic = 'force-dynamic';

export default async function AvatarPage() {
  const session = await getSession();
  if (!session?.player) return redirectToSignIn();

  const player = await getPlayerById(session.player.playerId);
  if (!player) return redirectToSignIn();

  return (
    <AvatarBuilderPage
      playerId={player.id}
      initialConfig={player.avatar_config as AvatarConfig | null}
      initialPlayer={player}
    />
  );
}
