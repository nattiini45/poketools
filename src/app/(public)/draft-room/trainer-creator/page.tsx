import { getSessionPlayer } from '@/lib/auth/helpers';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { trainerCreatorMessages } from '@/i18n/messages/trainer-creator';
import TrainerCreatorClient from './client';

export const dynamic = 'force-dynamic';

export default async function TrainerCreatorPage() {
  const player = await getSessionPlayer();
  if (!player) redirect('/login');

  const t = await getT(trainerCreatorMessages);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-poke-text-secondary mt-1">
          {t('subtitle')}
        </p>
      </div>
      <TrainerCreatorClient playerId={player.playerId} />
    </div>
  );
}
