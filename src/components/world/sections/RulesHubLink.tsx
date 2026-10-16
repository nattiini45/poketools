'use client';

import Link from 'next/link';
import { useContext, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorldStateContext } from '@/components/world/route/WorldStateProvider';
import { rulesHubHref } from './rules-context';

interface RulesHubLinkProps {
  leagueId: string;
  className?: string;
  children: ReactNode;
}

/**
 * "Open the Rules tab" in the non-EPB #rules section and `?rules=gate`
 * panel. A client component because the link carries the viewer's query
 * (`rulesHubHref`): `?world=` stays, so the hub opens in the world the viewer
 * is in. On the route tier it is the Lite exit as well, and a plain anchor
 * (Lite is a full load: the tier is read once, at mount), because the hub
 * hides with the other sections while the scene is live. Outside a world
 * provider it is a soft link.
 */
export default function RulesHubLink({ leagueId, className, children }: RulesHubLinkProps) {
  const searchParams = useSearchParams();
  const world = useContext(WorldStateContext);
  const onRoute = world?.tier === 'route';
  const href = rulesHubHref(leagueId, searchParams?.toString() ?? '', {
    panelParams: world?.theme?.focusVocabulary.panelParams ?? [],
    lite: onRoute,
  });

  if (onRoute) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
