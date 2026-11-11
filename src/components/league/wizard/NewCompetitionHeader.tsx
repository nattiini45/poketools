import type { ReactNode } from 'react';
import { getT } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import CompetitionKindSwitch from './CompetitionKindSwitch';

/** The shared top of both create pages: the title, one line of help and the league or tournament switch. */
export default async function NewCompetitionHeader({ kind, children }: { kind: 'league' | 'tournament'; children?: ReactNode }) {
  const t = await getT(leagueAdminMessages);
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-display text-fg">{t('wizard.title')}</h1>
        <p className="max-w-prose text-sm text-fg-muted">{t(kind === 'league' ? 'wizard.intro' : 'wizard.tournamentIntro')}</p>
      </div>
      <CompetitionKindSwitch current={kind} />
      {children}
    </header>
  );
}
