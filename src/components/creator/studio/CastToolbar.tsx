'use client';

import { useCastStudio } from './CastStudioContext';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

export default function CastToolbar() {
  const { state, dispatch } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const syncLabel = state.syncStatus === 'connected'
    ? t('toolbar.sync.connected')
    : state.syncStatus === 'local-only'
      ? t('toolbar.sync.localOnly')
      : t('toolbar.sync.syncing');
  const syncClass = state.syncStatus === 'connected'
    ? 'bg-green-500'
    : state.syncStatus === 'error'
      ? 'bg-red-500'
      : 'bg-yellow-500';

  return (
    <div className="flex items-center gap-4 rounded-poke-md bg-poke-surface border border-poke-border px-4 py-2">
      {/* Session name (editable) */}
      <input
        type="text"
        value={state.sessionName}
        onChange={(e) => dispatch({ type: 'set_session_name', name: e.target.value })}
        className="bg-transparent border-none text-poke-text-primary font-heading font-bold text-lg focus:outline-none focus:ring-0 min-w-0 flex-1"
        placeholder={t('toolbar.sessionNamePlaceholder')}
      />

      {/* Mode badge */}
      <span className="rounded-full bg-poke-muted px-2.5 py-0.5 text-xs font-heading font-bold uppercase tracking-wide text-poke-text-secondary">
        {t.dynamic(`mode.${state.mode}`, undefined, state.mode)}
      </span>

      {/* Format badge */}
      <span className="rounded-full bg-poke-muted px-2.5 py-0.5 text-xs font-mono text-poke-text-secondary">
        {state.format}
      </span>

      {/* Show Facing toggle */}
      <button
        onClick={() => dispatch({ type: 'toggle_show_facing' })}
        className={`rounded-poke-md px-3 py-1 text-xs font-heading font-bold transition-colors ${
          state.showFacing
            ? 'bg-poke-accent text-poke-surface'
            : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-accent/20'
        }`}
      >
        {t('toolbar.facing')}
      </button>

      {/* Open tools in new tab */}
      <button
        onClick={() => window.open(`/creator/studio/${state.sessionId}/tools`, '_blank')}
        className="rounded-poke-md bg-poke-muted px-3 py-1 text-xs font-heading font-bold text-poke-text-secondary hover:bg-poke-accent/20 transition-colors"
      >
        {t('toolbar.openTools')}
      </button>

      {/* Save indicator */}
      <div className="flex items-center gap-1.5 text-xs text-poke-text-secondary">
        {state.saving ? (
          <span className="animate-pulse">{t('toolbar.saving')}</span>
        ) : state.dirty ? (
          <span className="text-yellow-500">{t('toolbar.unsaved')}</span>
        ) : (
          <span className="text-green-500">{t('toolbar.saved')}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-poke-text-secondary">
        <span className={`h-2 w-2 rounded-full ${syncClass}`} />
        <span>{syncLabel}</span>
      </div>
    </div>
  );
}
