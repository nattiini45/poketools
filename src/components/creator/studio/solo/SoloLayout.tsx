'use client';

import { useCallback, useState } from 'react';
import { useCastStudio } from '../CastStudioContext';
import CastTeamEditor from '../CastTeamEditor';
import CastToolbar from '../CastToolbar';
import SoloFormatPicker from './SoloFormatPicker';
import SoloMyTeamPanel from './SoloMyTeamPanel';
import KOTracker from './KOTracker';
import SoloGameControls from './SoloGameControls';
import SoloMetaPanel from './SoloMetaPanel';
import { useLocale, useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

const OVERLAY_URLS = [
  { labelKey: 'koStats', path: 'ko-stats' },
  { labelKey: 'teamPreview', path: 'team-preview' },
  { labelKey: 'sessionRecord', path: 'session-record' },
  { labelKey: 'live', path: 'live' },
] as const;

/**
 * SoloLayout — layout for solo livestreamers.
 * Format picker at top, My Team (loadable + editable) on the left with
 * KO tracker, Opponent (fully editable, resettable) on the right,
 * game controls and overlay controls at bottom.
 */
export default function SoloLayout() {
  const { state, dispatch } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const locale = useLocale();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleNewOpponent = useCallback(() => {
    if (!confirm(t('solo.newOpponentConfirm'))) return;
    dispatch({ type: 'new_opponent' });
  }, [dispatch, t]);

  // Overlays never read the viewer's cookie (i18n-core §6.5): the URL carries
  // the language, defaulting to the streamer's current UI language.
  const overlayPath = (path: string) => `/broadcast/solo/${state.sessionId}/${path}?lang=${locale}`;

  const copyUrl = (path: string) => {
    const url = `${window.location.origin}${overlayPath(path)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(path);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <CastToolbar />
      <SoloFormatPicker />

      <div className="grid grid-cols-2 gap-6">
        {/* My Team — loadable, editable, with KO tracker */}
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-bold text-poke-text-primary">
            {t('solo.myTeam')}
          </h2>
          <SoloMyTeamPanel />
          <KOTracker />
        </div>

        {/* Opponent Team — fully editable, resettable */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-poke-text-primary">
              {t('solo.opponent')}
            </h2>
            <button
              onClick={handleNewOpponent}
              className="rounded-poke-md bg-poke-muted px-3 py-1.5 text-xs font-heading font-bold text-poke-text-secondary hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              {t('solo.newOpponent')}
            </button>
          </div>
          <CastTeamEditor player={2} />
          <SoloMetaPanel />
        </div>
      </div>

      {/* Game controls: Win/Loss, session record */}
      <SoloGameControls />

      {/* Overlay controls */}
      <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-4">
        <h3 className="font-heading text-sm font-bold text-poke-text-secondary uppercase tracking-wide mb-2">
          {t('solo.overlayControls')}
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OVERLAY_URLS.map(({ labelKey, path }) => (
            <div key={path} className="flex gap-1">
              <button
                onClick={() => window.open(overlayPath(path), '_blank')}
                className="flex-1 rounded-poke-md bg-poke-muted px-3 py-1.5 text-xs font-heading font-bold text-poke-text-secondary hover:bg-poke-accent/20 transition-colors"
              >
                {t(`solo.overlays.${labelKey}`)}
              </button>
              <button
                onClick={() => copyUrl(path)}
                className="rounded-poke-md bg-poke-muted px-2 py-1.5 text-xs text-poke-text-secondary hover:bg-poke-accent/20 transition-colors"
                title={t('solo.copyUrlTitle')}
              >
                {copiedUrl === path ? '✓' : '⎘'}
              </button>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-poke-text-secondary mt-2">
          {t('solo.overlayHint')}
        </p>
      </div>
    </div>
  );
}
