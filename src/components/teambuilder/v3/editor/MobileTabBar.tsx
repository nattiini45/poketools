'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import BottomSheet from '@/components/shared/BottomSheet';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import IntelPanel from '../intel/IntelPanel';
import AiPanel from '../ai/AiPanel';
import ValidationPanel from '../validation/ValidationPanel';
import type { TeamValidationResult } from '@/types/team';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

type MobileSheet = 'intel' | 'validation' | 'ai' | null;

const TABS: { id: Exclude<MobileSheet, null>; icon: ItemIconId }[] = [
  { id: 'intel', icon: 'scope-lens' },
  { id: 'validation', icon: 'ability-shield' },
  { id: 'ai', icon: 'up-grade' },
];

interface MobileTabBarProps {
  /** The latest verdict; the validation sheet is the only place below `lg` that lists the team-level issues and notes. */
  validation: TeamValidationResult | null;
  seasonId?: string | null;
  /** Jumping to an issue closes the sheet, so the set it points at is on screen. */
  onJumpToIssue?: (issueId: string) => void;
  /** Saves the team; omitted for a locked team, which shows no Save. */
  onSave?: () => void;
  saving?: boolean;
  /** Blocking issues of the latest verdict, shown as a count on Save. */
  errorCount?: number;
}

/**
 * MobileTabBar — the sticky bottom bar below `lg`: the Intel, Validation and AI panels as bottom sheets (the right
 * column they live in is hidden there) and Save, the editor's primary action, in the thumb zone.
 * Species/move/item picking happens inline in the workspace, so no separate browser sheet is needed.
 */
export default function MobileTabBar({ validation, seasonId, onJumpToIssue, onSave, saving = false, errorCount = 0 }: MobileTabBarProps) {
  const t = useT(teambuilderMessages);
  const [activeSheet, setActiveSheet] = useState<MobileSheet>(null);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {TABS.map((tab) => {
          const active = activeSheet === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={active}
              onClick={() => setActiveSheet(active ? null : tab.id)}
              className={[
                'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-caption transition-colors duration-80 ease-out',
                active ? 'font-[550] text-fg' : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-4 top-0 h-[3px] bg-accent-ink [transform:skewX(var(--skew))]" />}
              <ItemIcon item={tab.icon} />
              <span>{t(`mobile.${tab.id}`)}</span>
            </button>
          );
        })}
        {onSave && (
          <div className="flex items-center px-3">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              aria-label={t('editor.fab.save')}
              className="inline-flex min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SkewPlate variant="button" className="px-4 py-2.5 text-body">
                <span className="inline-flex items-center gap-2">
                  <Save size={16} aria-hidden="true" />
                  {t('editor.save')}
                  {errorCount > 0 && (
                    <span className="rounded-full bg-loss-bg px-1.5 font-mono text-caption text-loss" title={t('editor.saveErrors', { count: errorCount })}>
                      {errorCount}
                    </span>
                  )}
                </span>
              </SkewPlate>
            </button>
          </div>
        )}
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
