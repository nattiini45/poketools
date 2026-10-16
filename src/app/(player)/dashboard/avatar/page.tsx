import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import type { AvatarConfig } from '@/types/avatar';
import AvatarBuilderPage from './AvatarBuilderPage';

export const dynamic = 'force-dynamic';

export default async function AvatarPage() {
  const session = await getSession();
  if (!session?.player) redirect('/auth/signin');

  const player = await getPlayerById(session.player.playerId);
  if (!player) redirect('/auth/signin');

  return (
    <AvatarBuilderPage
      playerId={player.id}
      initialConfig={player.avatar_config as AvatarConfig | null}
      initialPlayer={player}
    />
  );
}
