'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SkewPlate from '@/components/ui/SkewPlate';
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
    <nav className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
      <div className="-mx-1 flex items-center gap-3 overflow-x-auto px-2 py-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="inline-flex min-h-11 shrink-0 items-center text-body"
            >
              <SkewPlate variant="tab" active={active} glideId="creator-nav">
                {t(`nav.${tab.labelKey}`)}
              </SkewPlate>
            </Link>
          );
        })}
      </div>
      {playerName && <span className="shrink-0 text-caption text-fg-muted">{playerName}</span>}
    </nav>
  );
}
