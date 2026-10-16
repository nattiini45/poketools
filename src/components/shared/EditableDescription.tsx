'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { uiMessages } from '@/i18n/messages/ui';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';

interface EditableDescriptionProps {
  /** 'season' or 'tournament' — determines the API endpoint */
  resourceType: 'season' | 'tournament';
  resourceId: string;
  initialValue: string;
}

/** The API's error, or a failure without one (shown as `ui.description.failed`). Never translated text. */
type SaveError = { kind: 'api'; error: ApiErrorLike } | { kind: 'failed' };

export default function EditableDescription({
  resourceType,
  resourceId,
  initialValue,
}: EditableDescriptionProps) {
  const t = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);

  const endpoint = resourceType === 'season'
    ? `/api/seasons/${resourceId}`
    : `/api/tournaments/${resourceId}`;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: value }),
      });
      const data = await res.json();
      if (!data.success) {
        const apiError = toApiErrorLike(data);
        setError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'failed' });
        return;
      }
      setSaved(value);
      setEditing(false);
    } catch (err) {
      const apiError = toApiErrorLike(err);
      setError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'failed' });
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {saved ? (
          <p className="text-sm text-poke-text-muted whitespace-pre-wrap">{saved}</p>
        ) : (
          <p className="text-sm text-poke-text-muted italic">
            {t('description.empty')}
          </p>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-poke-blue hover:underline font-heading"
        >
          {saved ? t('description.edit') : t('description.add')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('description.placeholder')}
        rows={4}
        className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted transition-colors duration-200 focus:border-poke-focus focus:ring-1 focus:ring-poke-focus outline-none text-sm resize-y"
        autoFocus
      />
      {error && (
        <p className="text-xs text-poke-danger">
          {error.kind === 'api' ? errorText(error.error) : t('description.failed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSave}
          loading={saving}
        >
          {t('description.save')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setValue(saved); setEditing(false); setError(null); }}
          disabled={saving}
        >
          {t('description.cancel')}
        </Button>
      </div>
    </div>
  );
}
