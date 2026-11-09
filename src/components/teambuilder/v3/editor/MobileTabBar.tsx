'use client';

import { useState } from 'react';
import BottomSheet from '@/components/shared/BottomSheet';
import IntelPanel from '../intel/IntelPanel';
import AiPanel from '../ai/AiPanel';
import ValidationPanel from '../validation/ValidationPanel';
import type { TeamValidationResult } from '@/types/team';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

type MobileSheet = 'intel' | 'validation' | 'ai' | null;

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
    id: 'validation' as const,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
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

interface MobileTabBarProps {
  /** The latest verdict; the validation sheet is the only place below `lg` that lists the team-level issues and notes. */
  validation: TeamValidationResult | null;
  seasonId?: string | null;
  /** Jumping to an issue closes the sheet, so the set it points at is on screen. */
  onJumpToIssue?: (issueId: string) => void;
}

/**
 * MobileTabBar — bottom tab bar (<lg) surfacing the Intel, Validation and AI
 * panels as bottom sheets (the right column they live in is hidden below `lg`).
 * Species/move/item picking happens inline in the workspace, so no separate
 * browser sheet is needed.
 */
export default function MobileTabBar({ validation, seasonId, onJumpToIssue }: MobileTabBarProps) {
  const t = useT(teambuilderMessages);
  const [activeSheet, setActiveSheet] = useState<MobileSheet>(null);

  return (
    <>
      {/* Fixed bottom tab bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-poke-surface border-t border-poke-border flex lg:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={activeSheet === tab.id}
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

      {/* Validation sheet */}
      <BottomSheet
        open={activeSheet === 'validation'}
        onClose={() => setActiveSheet(null)}
        title={t('mobile.validationSheet')}
        height="full"
      >
        <ValidationPanel
          validation={validation}
          seasonId={seasonId}
          onJumpToIssue={(issueId) => {
            setActiveSheet(null);
            onJumpToIssue?.(issueId);
          }}
        />
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
