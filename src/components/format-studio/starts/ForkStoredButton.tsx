'use client';

import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { forkFormatRequest } from '@/lib/format-studio/editor/api';
import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { formatEditorHref } from '../editor/hrefs';

/** Fork a stored format: a private copy of its last published version (or of the draft, for its owner). */
export default function ForkStoredButton({ definitionId, hint = true }: { definitionId: string; hint?: boolean }) {
  const t = useT(formatStudioEditorMessages);
  return (
    <StartActionButton
      label={t('list.fork')}
      variant="secondary"
      hint={hint ? t('new.forkStoredHint') : undefined}
      run={() => forkFormatRequest(definitionId)}
      editorHref={formatEditorHref}
    />
  );
}
