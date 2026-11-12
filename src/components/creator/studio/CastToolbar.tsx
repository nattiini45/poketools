'use client';

import { useCastStudio } from './CastStudioContext';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsBroadcast } from '@/i18n/messages/errors';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';

export default function CastToolbar() {
  const { state, dispatch } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const errorText = useApiErrorText(errorsBroadcast);
  const syncLabel = state.syncStatus === 'connected'
    ? t('toolbar.sync.connected')
    : state.syncStatus === 'local-only'
      ? t('toolbar.sync.localOnly')
      : t('toolbar.sync.syncing');
  const syncClass = state.syncStatus === 'connected'
    ? 'bg-win'
    : state.syncStatus === 'error'
      ? 'bg-loss'
      : 'bg-accent-fill';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-poke-lg border border-hairline bg-surface px-4 py-2">
      {/* Session name (editable) */}
      <input
        type="text"
        value={state.sessionName}
        onChange={(e) => dispatch({ type: 'set_session_name', name: e.target.value })}
        className="min-w-0 flex-1 basis-48 rounded-poke-md border-none bg-transparent font-heading text-title text-fg focus:outline-2 focus:outline-offset-2 focus:outline-transparent focus:ring-0 focus-visible:outline-solid focus-visible:outline-[var(--focus-ring)]"
        placeholder={t('toolbar.sessionNamePlaceholder')}
      />

      {/* Mode badge */}
      <SkewChip>{t.dynamic(`mode.${state.mode}`, undefined, state.mode)}</SkewChip>

      {/* Format badge */}
      <SkewChip className="font-mono">{state.format}</SkewChip>

      {/* Show Facing toggle */}
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={state.showFacing}
        onClick={() => dispatch({ type: 'toggle_show_facing' })}
        className={state.showFacing ? 'bg-tier-1 text-tier-ink' : undefined}
      >
        {t('toolbar.facing')}
      </Button>

      {/* Open tools in new tab */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => window.open(`/creator/studio/${state.sessionId}/tools`, '_blank')}
      >
        {t('toolbar.openTools')}
      </Button>

      {/* Save indicator */}
      <div className="flex items-center gap-1.5 text-caption text-fg-muted">
        {state.save.status === 'saving' ? (
          <span className="animate-pulse">{t('toolbar.saving')}</span>
        ) : state.save.status === 'dirty' ? (
          <span className="text-accent-ink">{t('toolbar.unsaved')}</span>
        ) : state.save.status === 'error' ? (
          <span className="text-loss" title={errorText(state.save.error)}>{t('toolbar.saveFailed')}</span>
        ) : (
          <span className="text-win">{t('toolbar.saved')}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-caption text-fg-muted">
        <span className={`h-2 w-2 rounded-full ${syncClass}`} />
        <span>{syncLabel}</span>
      </div>
    </div>
  );
}
