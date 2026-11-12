import Link from 'next/link';
import SkewPlate from '@/components/ui/SkewPlate';
import { getT } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

/** League or tournament, as two links between the two create pages (`/admin/leagues/new`, `/admin/tournaments/new`). */
export default async function CompetitionKindSwitch({ current }: { current: 'league' | 'tournament' }) {
  const t = await getT(leagueAdminMessages);
  const kinds = [
    { id: 'league', href: '/admin/leagues/new' },
    { id: 'tournament', href: '/admin/tournaments/new' },
  ] as const;
  return (
    <nav aria-label={t('wizard.kindLabel')} className="flex flex-wrap gap-2">
      {kinds.map((kind) => (
        <Link
          key={kind.id}
          href={kind.href}
          aria-current={kind.id === current ? 'page' : undefined}
          className="inline-flex min-h-11 items-center text-sm sm:min-h-0"
        >
          <SkewPlate variant="tab" active={kind.id === current}>
            {t(`wizard.kind.${kind.id}`)}
          </SkewPlate>
        </Link>
      ))}
    </nav>
  );
}
