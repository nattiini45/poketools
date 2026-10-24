'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useT } from '@/i18n/client';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import { forkPresetRequest, type ApiOutcome, type CreatedFormatResponse } from '@/lib/format-studio/editor/api';

interface StartActionButtonProps {
  label: string;
  /** A sentence under the button. */
  hint?: string;
  variant?: 'primary' | 'secondary';
  /** The request that creates the new format. */
  run: () => Promise<ApiOutcome<CreatedFormatResponse>>;
}

/**
 * A button that creates a format through the library API and opens it in the editor. It shows its own loading
 * state and its own error (in the viewer's language, by error code), and stays enabled after a failure so the
 * request can be tried again.
 */
export function StartActionButton({ label, hint, variant = 'primary', run }: StartActionButtonProps) {
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const outcome = await run();
    if (outcome.ok) {
      // The page changes next; the button keeps its loading state until it does.
      router.push(`/admin/formats/${encodeURIComponent(outcome.data.definition.id)}/edit`);
      return;
    }
    setError(outcome.error);
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant={variant} className="min-h-11 sm:min-h-0" loading={busy} aria-busy={busy} onClick={() => void start()}>
        {label}
      </Button>
      {hint !== undefined && <p className="text-sm text-poke-text-muted">{hint}</p>}
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
    </div>
  );
}

/** "Use as a starting point" on an example format: forks the example into a private copy and opens it. */
export default function ForkPresetButton({ presetId }: { presetId: string }) {
  const t = useT(formatStudioEditorMessages);
  return <StartActionButton label={t('new.fork')} hint={t('new.forkPresetHint')} run={() => forkPresetRequest(presetId)} />;
}
