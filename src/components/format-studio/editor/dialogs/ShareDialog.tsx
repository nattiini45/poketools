'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import { canSetVisibility, type FormatActor } from '@/lib/format-studio/access';
import { visibilityRequest, type FetchLike } from '@/lib/format-studio/editor/api';
import { FORMAT_VISIBILITIES, type FormatDefinitionMeta, type FormatVisibility } from '@/lib/format-studio/library-types';

type DefinitionAccess = Pick<FormatDefinitionMeta, 'kind' | 'owner_id' | 'visibility'>;

interface ShareDialogBodyProps {
  actor: FormatActor;
  definition: DefinitionAccess;
  /** A version is published: only then can the format be shared. */
  hasPublished: boolean;
  selected: FormatVisibility;
  onSelect: (visibility: FormatVisibility) => void;
  busy: boolean;
  error: ApiErrorLike | null;
  onApply: () => void;
  onClose: () => void;
}

/** Why the whole dialog is read-only, or null when the viewer may change something. */
function readOnlyReason(actor: FormatActor, definition: DefinitionAccess): 'galleryOwned' | 'siteAdminOnly' | null {
  if (actor.isAdmin) return null;
  if (definition.visibility === 'gallery') return 'galleryOwned';
  if (definition.kind !== 'custom' || definition.owner_id !== actor.playerId) return 'siteAdminOnly';
  return null;
}

/**
 * Who can use this format: private, shared with league admins, or in the gallery. The gallery choice exists for
 * site admins only (for others it is absent). A format that belongs to the gallery is read-only for its owner,
 * and sharing needs a published version. The rules are `canSetVisibility`, the same function the API applies.
 */
export function ShareDialogBody({ actor, definition, hasPublished, selected, onSelect, busy, error, onApply, onClose }: ShareDialogBodyProps) {
  const t = useT(formatStudioEditorMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const locked = readOnlyReason(actor, definition);
  const visible = FORMAT_VISIBILITIES.filter((value) => value !== 'gallery' || actor.isAdmin || definition.visibility === 'gallery');

  const disabledFor = (value: FormatVisibility): 'galleryOwned' | 'siteAdminOnly' | 'needPublish' | null => {
    if (locked !== null) return locked;
    if (!canSetVisibility(actor, definition, value)) return 'siteAdminOnly';
    if (value !== 'private' && !hasPublished) return 'needPublish';
    return null;
  };
  const unchanged = selected === definition.visibility;

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('share.title')}</legend>
        {visible.map((value) => {
          const reason = disabledFor(value);
          const id = `fe-share-${value}`;
          return (
            <div key={value} className="flex items-start gap-3 rounded-poke-md border border-poke-border p-3">
              <input
                id={id}
                type="radio"
                name="fe-share"
                value={value}
                checked={selected === value}
                disabled={reason !== null && selected !== value}
                aria-describedby={`${id}-help`}
                onChange={() => onSelect(value)}
                className="mt-1 h-4 w-4 shrink-0 accent-poke-accent"
              />
              <div className="min-w-0">
                <label htmlFor={id} className="block text-sm font-semibold text-poke-text-primary">
                  {t(`toolbar.visibility.${value}`)}
                </label>
                <p id={`${id}-help`} className="text-sm text-poke-text-muted">
                  {t(`share.${value}Help`)}
                  {reason !== null && selected !== value && ` ${t(`share.${reason}`)}`}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>

      {locked !== null && <p className="text-sm text-poke-text-muted">{t(`share.${locked}`)}</p>}
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t('save.cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} disabled={locked !== null || unchanged || disabledFor(selected) !== null} onClick={onApply}>
          {t('share.apply')}
        </Button>
      </div>
    </div>
  );
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  definitionId: string;
  actor: FormatActor;
  definition: DefinitionAccess;
  hasPublished: boolean;
  /** The visibility changed on the server. */
  onChanged: (visibility: FormatVisibility) => void;
  fetchImpl?: FetchLike;
}

/** The share dialog: picks a visibility and sends it. The result shows in the toolbar. */
export default function ShareDialog({ open, onClose, definitionId, actor, definition, hasPublished, onChanged, fetchImpl }: ShareDialogProps) {
  const t = useT(formatStudioEditorMessages);
  const [selected, setSelected] = useState<FormatVisibility>(definition.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await visibilityRequest(definitionId, selected, fetchImpl);
      if (outcome.ok) {
        onChanged(outcome.data.definition.visibility);
        onClose();
      } else {
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} size="md" title={t('share.title')}>
      <ShareDialogBody
        actor={actor}
        definition={definition}
        hasPublished={hasPublished}
        selected={selected}
        onSelect={setSelected}
        busy={busy}
        error={error}
        onApply={() => void apply()}
        onClose={onClose}
      />
    </Modal>
  );
}
