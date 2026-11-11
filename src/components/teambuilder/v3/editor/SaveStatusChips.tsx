'use client';

import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import type { EditorState } from './state';

interface SaveStatusChipsProps {
  saveStatus: EditorState['saveStatus'];
  dirty: boolean;
  locked: boolean;
}

/**
 * The save-state chips of the editor's toolbar, as skewed plates. `warned` ("saved, rules not met") and `unchecked`
 * ("saved, rules could not be checked") are the player's only signal that a saved team breaks, or could not be checked
 * against, the league's team rules (the server saves it anyway); both show only while the editor holds nothing newer
 * than the saved team. A screen reader announces them through one always-mounted, visually hidden `role="status"`
 * region whose text changes (a live region inserted together with its text is announced unreliably), so the visible
 * chips carry no role of their own. The warning sits on the accent wash with the accent ink (4.5:1 in both themes);
 * below `lg` the validation sheet of the mobile bar lists the cause.
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
  const chips: { key: string; tone: SkewChipTone; label: string }[] = [];
  if (locked) chips.push({ key: 'locked', tone: 'neutral', label: t('editor.status.locked') });
  if (saveStatus === 'saving') chips.push({ key: 'saving', tone: 'neutral', label: t('editor.status.saving') });
  if (saveStatus === 'saved' && !dirty) chips.push({ key: 'saved', tone: 'win', label: t('editor.status.saved') });
  if (saveStatus === 'warned' && !dirty) chips.push({ key: 'warned', tone: 'accent', label: t('editor.status.savedWithIssues') });
  if (saveStatus === 'unchecked' && !dirty) chips.push({ key: 'unchecked', tone: 'neutral', label: t('editor.status.savedUnchecked') });
  if (saveStatus === 'error') chips.push({ key: 'error', tone: 'loss', label: t('editor.status.saveFailed') });
  if (dirty && !locked && saveStatus !== 'saving') chips.push({ key: 'unsaved', tone: 'accent', label: t('editor.status.unsaved') });
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {chips.map((chip) => (
        <SkewChip key={chip.key} tone={chip.tone}>
          {chip.label}
        </SkewChip>
      ))}
    </>
  );
}
