'use client';

import dynamic from 'next/dynamic';
import { useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { useEditorContext } from '../editor/EditorContext';
import IntelSubjectStrip from './IntelSubjectStrip';

// Lazy-load each tab to keep initial bundle small
const OverviewTab = dynamic(() => import('./OverviewTab'), { ssr: false });
const SetsTab = dynamic(() => import('./SetsTab'), { ssr: false });
const CalcTab = dynamic(() => import('./CalcTab'), { ssr: false });
const SpeedTab = dynamic(() => import('./SpeedTab'), { ssr: false });

/** Tab ids double as the `intel.tabs.*` message keys. */
const TABS = ['overview', 'sets', 'calc', 'speed'] as const;

export default function IntelPanel() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const active = state.intelTab;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-poke-border shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => dispatch({ type: 'SET_INTEL_TAB', tab })}
            className={[
              'flex-1 py-1.5 text-[11px] font-medium transition-colors',
              active === tab
                ? 'text-poke-blue border-b-2 border-poke-blue -mb-px'
                : 'text-poke-text-muted hover:text-poke-text-secondary',
            ].join(' ')}
          >
            {t(`intel.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Subject selector for the per-mon tabs (Overview is team-wide) */}
      {active !== 'overview' && <IntelSubjectStrip />}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {active === 'overview' && <OverviewTab />}
        {active === 'sets' && <SetsTab />}
        {active === 'calc' && <CalcTab />}
        {active === 'speed' && <SpeedTab />}
      </div>
    </div>
  );
}
