'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useCastStudio } from '../CastStudioContext';
import CastTeamEditor from '../CastTeamEditor';
import CastToolbar from '../CastToolbar';
import SoloFormatPicker from './SoloFormatPicker';
import SoloMyTeamPanel from './SoloMyTeamPanel';
import KOTracker from './KOTracker';
import SoloGameControls from './SoloGameControls';
import SoloMetaPanel from './SoloMetaPanel';
import Button from '@/components/ui/Button';
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* My Team — loadable, editable, with KO tracker */}
        <div className="space-y-4">
          <h2 className="font-heading text-title text-fg">{t('solo.myTeam')}</h2>
          <SoloMyTeamPanel />
          <KOTracker />
        </div>

        {/* Opponent Team — fully editable, resettable */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-title text-fg">{t('solo.opponent')}</h2>
            <Button variant="secondary" size="sm" onClick={handleNewOpponent}>
              {t('solo.newOpponent')}
            </Button>
          </div>
          <CastTeamEditor player={2} />
          <SoloMetaPanel />
        </div>
      </div>

      {/* Game controls: Win/Loss, session record */}
      <SoloGameControls />

      {/* Overlay controls */}
      <div className="rounded-poke-lg border border-hairline bg-surface p-4">
        <h3 className="mb-2 font-heading text-subtitle text-fg">{t('solo.overlayControls')}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OVERLAY_URLS.map(({ labelKey, path }) => (
            <div key={path} className="flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => window.open(overlayPath(path), '_blank')}
              >
                {t(`solo.overlays.${labelKey}`)}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyUrl(path)}
                title={t('solo.copyUrlTitle')}
                aria-label={t('solo.copyUrlTitle')}
              >
                {copiedUrl === path ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-caption text-fg-muted">
          {t('solo.overlayHint')}
        </p>
      </div>
    </div>
  );
}
