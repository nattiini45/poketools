'use client';

import Link from 'next/link';
import { Trophy } from 'lucide-react';
import SkewPlate from '@/components/ui/SkewPlate';
import { useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import type { ProfileTrophy } from '@/types/profile';
import { ordinalSuffix } from './ordinal';

interface ProfileTrophiesProps {
  trophies: ProfileTrophy[];
}

/** Podium finishes as rank plates: gold, peach and blue for first, second and third. */
export default function ProfileTrophies({ trophies }: ProfileTrophiesProps) {
  const t = useT(profileMessages);
  if (trophies.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1 px-1">
      {trophies.map((trophy) => (
        <li key={trophy.id}>
          <Link
            href={`/tournaments/${trophy.id}`}
            className="flex min-h-11 items-center gap-3 rounded-poke-sm text-body font-[550] text-fg transition-colors duration-80 ease-out hover:text-accent-ink"
          >
            <span className="inline-flex shrink-0">
              <SkewPlate variant="rank" tier={trophy.rank} className="px-2.5 py-1 text-caption tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <Trophy aria-hidden="true" className="h-3.5 w-3.5" />
                  {t(`ordinal.${ordinalSuffix(trophy.rank)}`, { n: trophy.rank })}
                </span>
              </SkewPlate>
            </span>
            <span className="min-w-0 truncate">{trophy.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
