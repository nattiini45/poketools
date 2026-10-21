'use client';

import Link from 'next/link';
import { useT } from '@/i18n/client';
import { creatorMessages } from '@/i18n/messages/creator';

interface QuickActionCard {
  /** Key under `creator.quickActions` (title and description). */
  key: 'newSession' | 'wiki' | 'overlays';
  href: string;
  icon: string;
}

const actions: readonly QuickActionCard[] = [
  { key: 'newSession', href: '/creator/studio', icon: '[>]' },
  { key: 'wiki', href: '/wiki', icon: '[?]' },
  { key: 'overlays', href: '/creator/overlays', icon: '[#]' },
];

export default function QuickActions() {
  const t = useT(creatorMessages);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group rounded-poke-lg border border-poke-border bg-poke-surface p-5 shadow-poke-sm hover:border-poke-accent transition-colors duration-200"
        >
          <span className="text-lg font-mono text-poke-accent">{action.icon}</span>
          <h3 className="mt-2 text-sm font-heading font-bold text-poke-text-primary group-hover:text-poke-accent transition-colors">
            {t(`quickActions.${action.key}.title`)}
          </h3>
          <p className="mt-1 text-xs text-poke-text-secondary leading-relaxed">
            {t(`quickActions.${action.key}.description`)}
          </p>
        </Link>
      ))}
    </div>
  );
}
