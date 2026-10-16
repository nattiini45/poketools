'use client';

import { usePathname } from 'next/navigation';
import { NavLink } from '@/components/shared/NavBar';
import { useT } from '@/i18n/client';
import { creatorMessages } from '@/i18n/messages/creator';

interface CreatorNavProps {
  playerName?: string;
}

const tabs = [
  { href: '/creator/studio', labelKey: 'studio' },
  { href: '/wiki', labelKey: 'wiki' },
  { href: '/creator/overlays', labelKey: 'overlays' },
] as const;

export default function CreatorNav({ playerName }: CreatorNavProps) {
  const pathname = usePathname();
  const t = useT(creatorMessages);

  return (
    <nav className="flex items-center justify-between gap-4 border-b border-poke-border pb-3">
      <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.href}
            href={tab.href}
            label={t(`nav.${tab.labelKey}`)}
            active={pathname === tab.href || pathname.startsWith(`${tab.href}/`)}
            layoutId="creator-nav-underline"
          />
        ))}
      </div>
      {playerName && (
        <span className="text-xs text-poke-text-secondary font-body">
          {playerName}
        </span>
      )}
    </nav>
  );
}
