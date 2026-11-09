'use client';

import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import type { EditorState } from './state';

interface SaveStatusChipsProps {
  saveStatus: EditorState['saveStatus'];
  dirty: boolean;
  locked: boolean;
}

/**
 * The save-state badges of the editor's top bar. `warned` ("saved, rules not met") and `unchecked` ("saved, rules could
 * not be checked") are the player's only signal that a saved team breaks, or could not be checked against, the league's
 * team rules (the server saves it anyway); both show only while the editor holds nothing newer than the saved team.
 * A screen reader announces them through one always-mounted, visually hidden `role="status"` region whose text changes
 * (a live region inserted together with its text is announced unreliably), so the visible chips carry no role of their
 * own. The warning text uses the ink token (a static amber shade falls under 4.5:1 on the sunlit surfaces); below `lg`
 * the validation sheet of the mobile tab bar lists the cause.
 */
export default function SaveStatusChips({ saveStatus, dirty, locked }: SaveStatusChipsProps) {
  const t = useT(teambuilderMessages);
  const announcement = dirty
    ? ''
    : saveStatus === 'warned'
      ? t('editor.status.savedWithIssues')
      : saveStatus === 'unchecked'
        ? t('editor.status.savedUnchecked')
        : '';
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {locked && (
        <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
          {t('editor.status.locked')}
        </span>
      )}
      {saveStatus === 'saving' && (
        <span className="text-xs text-poke-text-muted bg-poke-surface px-2 py-0.5 rounded">
          {t('editor.status.saving')}
        </span>
      )}
      {saveStatus === 'saved' && !dirty && (
        <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
          {t('editor.status.saved')}
        </span>
      )}
      {saveStatus === 'warned' && !dirty && (
        <span className="text-xs text-poke-amber-ink bg-amber-500/15 px-2 py-0.5 rounded">
          {t('editor.status.savedWithIssues')}
        </span>
      )}
      {saveStatus === 'unchecked' && !dirty && (
        <span className="text-xs text-poke-text-muted bg-poke-surface px-2 py-0.5 rounded">
          {t('editor.status.savedUnchecked')}
        </span>
      )}
      {saveStatus === 'error' && (
        <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded">
          {t('editor.status.saveFailed')}
        </span>
      )}
      {dirty && !locked && saveStatus !== 'saving' && (
        <span className="text-xs text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
          {t('editor.status.unsaved')}
        </span>
      )}
    </>
  );
}
