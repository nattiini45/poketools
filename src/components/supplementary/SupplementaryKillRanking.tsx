'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import Table, { type Column } from '@/components/ui/Table';
import { useDataLocale, useMessages, useT } from '@/i18n/client';
import { statsMessages } from '@/i18n/messages/stats';
import { supplementaryRecordsMessages } from '@/i18n/messages/supplementary-records';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { foldForSearch } from '@/lib/pkmn/i18n/search';

/** One all-time supplementary KO total (English `@pkmn` name), as the page hands it over. */
export interface SupplementaryKillRowView {
  pokemonName: string;
  kos: number;
}

/**
 * The all-time kill ranking of supplementary records (docs/format-packs.md, "Pack extensions"):
 * species and KOs only, because records kept outside the live pipeline carry no per-game
 * appearances to rate them against. Labelled as earlier records; `failed` shows the notice.
 */
export default function SupplementaryKillRanking({
  rows,
  failed = false,
}: {
  rows: readonly SupplementaryKillRowView[];
  failed?: boolean;
}) {
  const t = useT(supplementaryRecordsMessages);
  const labels = useMessages(statsMessages).kills;
  const dl = useDataLocale();

  if (failed) {
    return (
      <p role="status" className="text-sm text-poke-text-tertiary">
        {t('loadFailed')}
      </p>
    );
  }

  const columns: Column<SupplementaryKillRowView>[] = [
    {
      key: 'rank',
      header: '#',
      width: '2.5rem',
      render: (_row, i) => <span className="text-poke-text-muted">{i + 1}</span>,
    },
    {
      key: 'pokemonName',
      header: labels.pokemon,
      sortable: true,
      sortValue: (row) => foldForSearch(localizeSpecies(row.pokemonName, dl)),
      render: (row) => (
        <PokemonLink name={row.pokemonName}>
          <AnimatedSprite>
            <PokemonSprite name={row.pokemonName} size={24} />
          </AnimatedSprite>
          <span className="font-medium">{localizeSpecies(row.pokemonName, dl)}</span>
        </PokemonLink>
      ),
    },
    {
      key: 'kos',
      header: labels.kos,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.kos,
      render: (row) => <span className="text-poke-green font-medium">{row.kos}</span>,
    },
  ];

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-heading font-semibold text-poke-text-primary">{t('title')}</h2>
      <p className="text-xs text-poke-text-tertiary">{t('note')}</p>
      <Table
        columns={columns}
        data={[...rows]}
        keyExtractor={(row) => row.pokemonName}
        emptyMessage={labels.empty}
        animated
        defaultSort={{ key: 'kos', direction: 'desc' }}
      />
    </div>
  );
}
