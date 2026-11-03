import { redirectToSignIn, requireLivePlayerOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getPlayerById } from '@/lib/supabase/queries/players';
import type { AvatarConfig } from '@/types/avatar';
import AvatarBuilderPage from './AvatarBuilderPage';

export const dynamic = 'force-dynamic';

export default async function AvatarPage() {
  const live = await requireLivePlayerOrSignIn();

  const player = await getPlayerById(live.playerId);
  if (!player) return redirectToSignIn();

  return (
    <AvatarBuilderPage
      playerId={player.id}
      initialConfig={player.avatar_config as AvatarConfig | null}
      initialPlayer={player}
    />
  );
}
