'use client';

import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { forkPresetRequest } from '@/lib/format-studio/editor/api';
import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { formatEditorHref } from '../editor/hrefs';

/** "Copy to edit" on an example format: forks the example into a private copy and opens it. */
export default function ForkPresetButton({ presetId, hint = true }: { presetId: string; hint?: boolean }) {
  const t = useT(formatStudioEditorMessages);
  return <StartActionButton label={t('new.copyToEdit')} variant="secondary" hint={hint ? t('new.forkPresetHint') : undefined} run={() => forkPresetRequest(presetId)} editorHref={formatEditorHref} />;
}
