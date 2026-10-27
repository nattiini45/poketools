'use client';

import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { useT } from '@/i18n/client';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { forkRulesetRequest } from '@/lib/ruleset-studio/editor/api';
import { rulesetEditorHref } from '../hrefs';

/** Fork a stored ruleset: a private copy of its last published version (or of the draft, for those who may edit it). */
export default function ForkStoredButton({ definitionId, hint = true }: { definitionId: string; hint?: boolean }) {
  const t = useT(rulesetStudioMessages);
  return (
    <StartActionButton
      label={t('list.fork')}
      variant="secondary"
      hint={hint ? t('new.forkHelp') : undefined}
      run={() => forkRulesetRequest(definitionId)}
      editorHref={rulesetEditorHref}
    />
  );
}
