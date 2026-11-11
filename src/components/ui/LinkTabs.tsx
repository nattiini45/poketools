import type { ReactNode } from 'react';
import Link from 'next/link';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';

export interface LinkTab {
  key: string;
  href: string;
  label: string;
  /** A leading item icon (`ItemIcon`, 24 px). */
  icon?: ReactNode;
  /** A count shown after the label. */
  count?: number;
}

interface LinkTabsProps {
  tabs: readonly LinkTab[];
  activeKey: string;
  /** Names the strip for assistive technology ("Filter by status", "League sections"). */
  label: string;
  /** Shared by the tabs of one strip, so the accent underside glides between them. */
  glideId: string;
  className?: string;
}

/**
 * One strip of link tabs on skewed plates (docs/design.md, "Skewed plates"): each tab is a link, so the state
 * lives in the URL and the server renders only the selected view. The strip scrolls sideways on a phone
 * instead of wrapping.
 */
export default function LinkTabs({ tabs, activeKey, label, glideId, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn('-mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]', className)}>
      <ul className="flex w-max items-center gap-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className="relative inline-flex whitespace-nowrap rounded-[3px] text-body"
              >
                <SkewPlate variant="tab" active={active} glideId={glideId} icon={tab.icon}>
                  <span className="inline-flex items-baseline gap-1.5">
                    {tab.label}
                    {tab.count !== undefined && <span className="font-mono text-caption tabular-nums text-fg-muted">{tab.count}</span>}
                  </span>
                </SkewPlate>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
