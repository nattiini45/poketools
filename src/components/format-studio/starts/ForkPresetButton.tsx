'use client';

import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { forkPresetRequest } from '@/lib/format-studio/editor/api';
import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { formatEditorHref } from '../editor/hrefs';

/** "Use as a starting point" on an example format: forks the example into a private copy and opens it. */
export default function ForkPresetButton({ presetId }: { presetId: string }) {
  const t = useT(formatStudioEditorMessages);
  return <StartActionButton label={t('new.fork')} hint={t('new.forkPresetHint')} run={() => forkPresetRequest(presetId)} editorHref={formatEditorHref} />;
}
