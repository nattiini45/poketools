'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, Layers, Radio, type LucideIcon } from 'lucide-react';
import { useT } from '@/i18n/client';
import { creatorMessages } from '@/i18n/messages/creator';

interface QuickActionCard {
  /** Key under `creator.quickActions` (title and description). */
  key: 'newSession' | 'wiki' | 'overlays';
  href: string;
  icon: LucideIcon;
}

const actions: readonly QuickActionCard[] = [
  { key: 'newSession', href: '/creator/studio', icon: Radio },
  { key: 'wiki', href: '/wiki', icon: BookOpen },
  { key: 'overlays', href: '/creator/overlays', icon: Layers },
];

export default function QuickActions() {
  const t = useT(creatorMessages);
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {actions.map((action) => (
        <li key={action.href}>
          <Link
            href={action.href}
            className="group flex h-full items-start gap-4 rounded-poke-lg border border-hairline bg-surface p-5 transition-[background-color,border-color] duration-80 ease-out hover:border-hairline-strong hover:bg-hover"
          >
            <span className="skew-plate mt-0.5 h-11 w-11 shrink-0 text-tier-ink">
              <span aria-hidden="true" className="skew-plate-bg bg-tier-1" />
              <action.icon aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-heading text-title text-fg">
                {t(`quickActions.${action.key}.title`)}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-accent-ink transition-transform duration-80 ease-out group-hover:translate-x-1 motion-reduce:transform-none"
                />
              </span>
              <span className="mt-1 block text-body text-fg-muted">{t(`quickActions.${action.key}.description`)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
