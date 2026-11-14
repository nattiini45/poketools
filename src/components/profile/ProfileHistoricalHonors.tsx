'use client';

import Link from 'next/link';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import type { HistoricalHonor } from '@/lib/pack-extensions/historical-statistics-types';
import { cn } from '@/lib/utils/cn';
import { FOCUS } from './focus';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

export default function ProfileHistoricalHonors({ honors }: { honors: readonly HistoricalHonor[] }) {
  const t = useT(profileMessages);
  const formatter = useFormatter();
  const dataLocale = useDataLocale();
  if (honors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {honors.map((honor) => (
        <li key={JSON.stringify([honor.eventKey, honor.kind, honor.playerIds, honor.pokemonName])}>
          <Link href={honor.competition.href} className={cn('flex min-h-11 flex-col justify-center rounded-poke-sm text-body text-fg hover:text-accent-ink', FOCUS)}>
            <span className="font-[550]">{honor.competition.name} · {t(`honors.${honor.kind}`)}</span>
            <span className="text-caption text-fg-muted">
              {t('honors.archive')}
              {honor.pokemonName && <> · {localizeSpecies(honor.pokemonName, dataLocale)}</>}
              {honor.shared && <> · {t('honors.shared')}</>}
              {honor.count !== null && <> · {formatter.number(honor.count)}</>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
