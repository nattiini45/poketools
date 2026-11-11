'use client';

import dynamic from 'next/dynamic';
import { useId } from 'react';
import SkewPlate from '@/components/ui/SkewPlate';
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
  const uid = useId();

  return (
    <div className="flex h-full flex-col">
      {/* One tab strip: skewed plates, the accent underside glides to the active tab */}
      <div role="tablist" aria-label={t('intel.tabsLabel')} className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-hairline px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${uid}-tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`${uid}-panel`}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => dispatch({ type: 'SET_INTEL_TAB', tab })}
            onKeyDown={(e) => {
              const i = TABS.indexOf(tab);
              const next =
                e.key === 'ArrowRight'
                  ? (i + 1) % TABS.length
                  : e.key === 'ArrowLeft'
                    ? (i + TABS.length - 1) % TABS.length
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? TABS.length - 1
                        : -1;
              if (next < 0) return;
              e.preventDefault();
              dispatch({ type: 'SET_INTEL_TAB', tab: TABS[next] });
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
            className={[
              'inline-flex min-h-9 shrink-0 items-center text-caption transition-colors duration-80 ease-out pointer-coarse:min-h-11',
              active === tab ? 'text-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            <SkewPlate variant="tab" active={active === tab} glideId="teambuilder-intel-tab" className="h-full text-inherit">
              {t(`intel.tabs.${tab}`)}
            </SkewPlate>
          </button>
        ))}
      </div>

      {/* Subject selector for the per-mon tabs (Overview is team-wide) */}
      {active !== 'overview' && <IntelSubjectStrip />}

      {/* Tab content */}
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active}`} className="min-h-0 flex-1 overflow-y-auto p-3">
        {active === 'overview' && <OverviewTab />}
        {active === 'sets' && <SetsTab />}
        {active === 'calc' && <CalcTab />}
        {active === 'speed' && <SpeedTab />}
      </div>
    </div>
  );
}
