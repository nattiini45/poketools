'use client';

import Card from '@/components/ui/Card';
import TypeSprite from '@/components/shared/TypeSprite';
import { useT } from '@/i18n/client';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import type { CoreTriple } from '@/types/season';

interface CoreLigaParticipantsProps {
  participants: Array<{
    id: string;
    name: string;
    coreTypes: CoreTriple | null;
  }>;
  /** Overrides the card's heading (default: `league-roster` `participants.heading`, in the viewer's language). */
  heading?: string;
}

/**
 * Read-only display of every participant's assigned Core Liga triple.
 * Hidden when no participant has a core (e.g. non-Core-Liga seasons).
 * A client leaf (i18n-core §1.7): its server parents pass plain props.
 */
export default function CoreLigaParticipants({ participants, heading }: CoreLigaParticipantsProps) {
  const t = useT(leagueRosterMessages);
  const withCores = participants.filter((p) => p.coreTypes !== null);
  if (withCores.length === 0) return null;

  return (
    <Card padding="md">
      <h3 className="font-heading font-semibold text-sm text-poke-text-primary mb-3">
        {heading ?? t('participants.heading')}
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {withCores.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span className="text-sm text-poke-text-primary">{p.name}</span>
            {p.coreTypes && (
              <span className="inline-flex items-center gap-1">
                {p.coreTypes.map((type) => (
                  <TypeSprite key={type} type={type} size={14} />
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
