'use client';

import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { createFormatRequest } from '@/lib/format-studio/editor/api';
import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { formatEditorHref } from '../editor/hrefs';

interface CopyLeagueStructureButtonProps {
  /** The league's structure as a format document (`leagueStructureDocument`, computed on the server). */
  definition: unknown;
}

/**
 * "Copy as a new format" on a league's format page: creates a private draft from the league's structure and
 * opens it. The copy leaves out the league's module settings and named rulesets; the hint says so.
 */
export default function CopyLeagueStructureButton({ definition }: CopyLeagueStructureButtonProps) {
  const t = useT(formatStudioEditorMessages);
  return (
    <StartActionButton
      label={t('new.copyLeague')}
      variant="secondary"
      hint={t('new.copyHelp')}
      run={() => createFormatRequest({ document: definition })}
      editorHref={formatEditorHref}
    />
  );
}
