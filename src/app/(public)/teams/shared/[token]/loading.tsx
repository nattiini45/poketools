import { getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';

export default async function SharedTeamLoading() {
  const t = await getT(teamsLibraryMessages);
  return (
    <div className="max-w-4xl mx-auto px-4 py-8" role="status" aria-label={t('shared.loading')}>
      <div className="h-6 w-56 rounded bg-poke-muted animate-pulse mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-40 rounded-poke-md border border-poke-border bg-poke-surface animate-pulse" />
        ))}
      </div>
    </div>
  );
}