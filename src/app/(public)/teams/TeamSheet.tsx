import type { ReactNode } from 'react';
import PageContainer from '@/components/ui/PageContainer';
import SpriteImg from '@/components/shared/SpriteImg';
import type { Translator } from '@/i18n/core';
import type { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { filledSets } from '@/lib/team/page-text';
import type { PokemonSet } from '@/types/team';
import TeamSetCard from './TeamSetCard';

/**
 * The team sheet both read-only team pages render (a library entry and a shared link): the team's name, the six
 * sprites in a row as its identity, then one member panel per set. A server component; the page passes its one
 * client island (fork or copy) as `action` or inside `children`.
 */
export default function TeamSheet({
  title,
  description,
  meta,
  action,
  sets,
  t,
  dl,
  showIvs = false,
  children,
}: {
  title: string;
  description?: string | null;
  /** Chips and the publish date, under the title. */
  meta?: ReactNode;
  action?: ReactNode;
  sets: PokemonSet[];
  t: Translator<typeof teamsLibraryMessages.en>;
  dl: DataLocale;
  showIvs?: boolean;
  children?: ReactNode;
}) {
  const roster = filledSets(sets);
  return (
    <PageContainer maxWidth="lg" title={title} subtitle={description ?? undefined} icon="choice-scarf" action={action}>
      {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{meta}</div>}

      {roster.length > 0 && (
        <ul
          aria-label={t('set.roster')}
          className="grid grid-cols-6 justify-items-center gap-1 rounded-poke-lg border border-hairline bg-sunken px-2 py-3 sm:px-6"
        >
          {roster.slice(0, 6).map((set, i) => (
            <li key={i}>
              <SpriteImg
                name={set.species}
                alt={localizeSpecies(set.species, dl)}
                width={72}
                height={72}
                className="h-12 w-12 sm:h-[72px] sm:w-[72px]"
              />
            </li>
          ))}
        </ul>
      )}

      <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set, i) => (
          <TeamSetCard key={i} set={set} index={i} t={t} dl={dl} showIvs={showIvs} />
        ))}
      </ol>

      {children}
    </PageContainer>
  );
}
