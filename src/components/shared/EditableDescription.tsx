'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { uiMessages } from '@/i18n/messages/ui';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { useServerSyncedState } from '@/hooks/useServerSyncedState';
import {
  clearDescriptionDraft,
  descriptionDraftKey,
  descriptionEditSeed,
  hasRestorableDraft,
  readDescriptionDraft,
  subscribeDescriptionDrafts,
  writeDescriptionDraft,
} from './description-draft';

interface EditableDescriptionProps {
  /** 'season' or 'tournament' — determines the API endpoint */
  resourceType: 'season' | 'tournament';
  resourceId: string;
  initialValue: string;
}

/** The API's error, or a failure without one (shown as `ui.description.failed`). Never translated text. */
type SaveError = { kind: 'api'; error: ApiErrorLike } | { kind: 'failed' };

/**
 * Inline description editor. A successful save refreshes the route, and the shown
 * text follows `initialValue` whenever no draft is open and no save is in flight,
 * so a remount or a refresh never brings back an older description.
 *
 * Unsaved text is not lost when the editor unmounts (a league admin tab switch,
 * a collapsed section, a reload): every keystroke is kept in the tab's
 * sessionStorage (`description-draft.ts`), and the next mount offers it back
 * ("Resume editing" / "Discard"). Save and Cancel drop the stored draft.
 * While a draft is offered, "Edit" opens the draft too, so the first keystroke
 * never overwrites it. When the browser refuses to store the draft, a short
 * notice says so (the storage failure itself is logged by `description-draft`).
 */
export default function EditableDescription({
  resourceType,
  resourceId,
  initialValue,
}: EditableDescriptionProps) {
  const router = useRouter();
  const t = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useServerSyncedState(initialValue, editing || saving);
  const [error, setError] = useState<SaveError | null>(null);
  /** The last keystroke could not be kept in sessionStorage. */
  const [draftNotKept, setDraftNotKept] = useState(false);
  const draftKey = descriptionDraftKey(resourceType, resourceId);
  // The server render (and a viewer without storage) sees no draft.
  const storedDraft = useSyncExternalStore(
    subscribeDescriptionDrafts,
    () => readDescriptionDraft(draftKey),
    () => null,
  );

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
      clearDescriptionDraft(draftKey);
      router.refresh();
    } catch (err) {
      const apiError = toApiErrorLike(err);
      setError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'failed' });
    } finally {
      setSaving(false);
    }
  }

  function handleInput(next: string) {
    setValue(next);
    if (next === saved) {
      clearDescriptionDraft(draftKey);
      setDraftNotKept(false);
    } else {
      setDraftNotKept(!writeDescriptionDraft(draftKey, next));
    }
  }

  // 44 px touch targets below `sm`.
  const touch = 'min-h-11 sm:min-h-0';

  if (!editing) {
    const restorable = hasRestorableDraft(storedDraft, saved);
    return (
      <div className="space-y-2">
        {restorable && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-poke-md border border-poke-border bg-poke-elevated px-3 py-2"
          >
            <p className="min-w-0 flex-1 text-xs text-poke-text-secondary">{t('description.draftFound')}</p>
            <Button
              variant="secondary"
              size="sm"
              className={touch}
              onClick={() => { setValue(storedDraft); setError(null); setEditing(true); }}
            >
              {t('description.resumeDraft')}
            </Button>
            <Button variant="ghost" size="sm" className={touch} onClick={() => clearDescriptionDraft(draftKey)}>
              {t('description.discardDraft')}
            </Button>
          </div>
        )}
        {saved ? (
          <p className="text-sm text-poke-text-muted whitespace-pre-wrap">{saved}</p>
        ) : (
          <p className="text-sm text-poke-text-muted italic">
            {t('description.empty')}
          </p>
        )}
        <button
          type="button"
          // An offered draft opens with its text: the first keystroke must not overwrite it.
          onClick={() => { setValue(descriptionEditSeed(storedDraft, saved)); setError(null); setEditing(true); }}
          className={`${touch} inline-flex items-center text-xs text-poke-blue hover:underline font-heading`}
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
        onChange={(e) => handleInput(e.target.value)}
        placeholder={t('description.placeholder')}
        rows={4}
        className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted motion-safe:transition-colors motion-safe:duration-200 focus:border-poke-focus focus:ring-1 focus:ring-poke-focus outline-none text-sm resize-y"
        autoFocus
      />
      {draftNotKept && (
        <p role="status" className="text-xs text-poke-text-secondary">
          {t('description.draftNotKept')}
        </p>
      )}
      {error && (
        <p className="text-xs text-poke-danger">
          {error.kind === 'api' ? errorText(error.error) : t('description.failed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className={touch}
          onClick={handleSave}
          loading={saving}
        >
          {t('description.save')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={touch}
          onClick={() => {
            setValue(saved);
            setEditing(false);
            setError(null);
            setDraftNotKept(false);
            clearDescriptionDraft(draftKey);
          }}
          disabled={saving}
        >
          {t('description.cancel')}
        </Button>
      </div>
    </div>
  );
}
