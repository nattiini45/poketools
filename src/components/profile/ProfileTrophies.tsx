import Link from 'next/link';
import type { ProfileTrophy } from '@/types/profile';

interface ProfileTrophiesProps {
  trophies: ProfileTrophy[];
}

const medalEmoji: Record<1 | 2 | 3, string> = {
  1: '\uD83E\uDD47',
  2: '\uD83E\uDD48',
  3: '\uD83E\uDD49',
};

const medalColor: Record<1 | 2 | 3, string> = {
  1: 'border-amber-300 bg-amber-50',
  2: 'border-gray-300 bg-gray-50',
  3: 'border-orange-300 bg-orange-50',
};

export default function ProfileTrophies({ trophies }: ProfileTrophiesProps) {
  if (trophies.length === 0) return null;

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
      <div className="flex flex-wrap gap-3">
        {trophies.map((trophy) => (
          <Link
            key={trophy.id}
            href={`/tournaments/${trophy.id}`}
            className={`inline-flex items-center gap-2 px-3 py-2 border rounded-poke-lg hover:shadow-poke-sm transition-shadow ${medalColor[trophy.rank]}`}
          >
            <span className="text-lg">{medalEmoji[trophy.rank]}</span>
            <span className="text-sm font-heading font-semibold text-poke-text-primary">
              {trophy.name}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
