'use client';

import { useState } from 'react';
import BottomSheet from '@/components/shared/BottomSheet';
import IntelPanel from '../intel/IntelPanel';
import AiPanel from '../ai/AiPanel';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

type MobileSheet = 'intel' | 'ai' | null;

const TABS = [
  {
    id: 'intel' as const,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    id: 'ai' as const,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    ),
  },
];

/**
 * MobileTabBar — bottom tab bar (<lg) surfacing the Intel and AI panels as
 * bottom sheets. Species/move/item picking happens inline in the workspace,
 * so no separate browser sheet is needed.
 */
export default function MobileTabBar() {
  const t = useT(teambuilderMessages);
  const [activeSheet, setActiveSheet] = useState<MobileSheet>(null);

  return (
    <>
      {/* Fixed bottom tab bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-poke-surface border-t border-poke-border flex lg:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSheet(activeSheet === tab.id ? null : tab.id)}
            className={[
              'flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors',
              activeSheet === tab.id
                ? 'text-poke-blue'
                : 'text-poke-text-muted hover:text-poke-text-secondary',
            ].join(' ')}
          >
            {tab.icon}
            <span className="text-[9px] font-medium">{t(`mobile.${tab.id}`)}</span>
          </button>
        ))}
      </div>

      {/* Intel sheet */}
      <BottomSheet
        open={activeSheet === 'intel'}
        onClose={() => setActiveSheet(null)}
        title={t('mobile.intelSheet')}
        height="full"
      >
        <IntelPanel />
      </BottomSheet>

      {/* AI sheet */}
      <BottomSheet
        open={activeSheet === 'ai'}
        onClose={() => setActiveSheet(null)}
        title={t('mobile.aiSheet')}
        height="full"
      >
        <div className="p-3">
          <AiPanel />
        </div>
      </BottomSheet>
    </>
  );
}
