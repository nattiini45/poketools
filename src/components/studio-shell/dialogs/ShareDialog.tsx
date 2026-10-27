'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { useApiErrorText } from '@/i18n/use-api-error';
import { STUDIO_VISIBILITIES, canSetVisibility, type DefAccess, type StudioActor, type StudioVisibility } from '@/lib/studio-core/access';
import type { ApiOutcome } from '@/lib/studio-core/request';
import type { ShellText } from '../text';

/** What the dialog needs of the stored definition: the columns the access rules read. */
type DefinitionAccess = Pick<DefAccess, 'kind' | 'owner_id' | 'visibility' | 'season_id'>;

/** The answer of the studio's visibility route. */
export interface VisibilityChanged {
  definition: { visibility: StudioVisibility };
}

interface ShareDialogBodyProps {
  /** The studio's words (`useShellText`). */
  text: ShellText;
  /** Prefix of the DOM ids and of the radio group name (`fe` for formats). */
  idPrefix: string;
  actor: StudioActor;
  definition: DefinitionAccess;
  /** A version is published: only then can the definition be shared. */
  hasPublished: boolean;
  selected: StudioVisibility;
  onSelect: (visibility: StudioVisibility) => void;
  busy: boolean;
  error: ApiErrorLike | null;
  onApply: () => void;
  onClose: () => void;
}

/** Why the whole dialog is read-only, or null when the viewer may change something. */
function readOnlyReason(actor: StudioActor, definition: DefinitionAccess): 'galleryOwned' | 'siteAdminOnly' | null {
  if (actor.isAdmin) return null;
  if (definition.visibility === 'gallery') return 'galleryOwned';
  if (definition.kind !== 'custom' || definition.owner_id !== actor.playerId) return 'siteAdminOnly';
  return null;
}

/**
 * Who can use this definition: private, shared with league admins, or in the gallery. The gallery choice exists for
 * site admins only (for others it is absent). A definition that belongs to the gallery is read-only for its owner, and
 * sharing needs a published version. The rules are `canSetVisibility`, the same function the API applies.
 */
export function ShareDialogBody({ text, idPrefix, actor, definition, hasPublished, selected, onSelect, busy, error, onApply, onClose }: ShareDialogBodyProps) {
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const locked = readOnlyReason(actor, definition);
  const visible = STUDIO_VISIBILITIES.filter((value) => value !== 'gallery' || actor.isAdmin || definition.visibility === 'gallery');

  const disabledFor = (value: StudioVisibility): 'galleryOwned' | 'siteAdminOnly' | 'needPublish' | null => {
    if (locked !== null) return locked;
    if (!canSetVisibility(actor, definition, value)) return 'siteAdminOnly';
    if (value !== 'private' && !hasPublished) return 'needPublish';
    return null;
  };
  const unchanged = selected === definition.visibility;

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="sr-only">{text('share.title')}</legend>
        {visible.map((value) => {
          const reason = disabledFor(value);
          const id = `${idPrefix}-share-${value}`;
          return (
            <div key={value} className="flex items-start gap-3 rounded-poke-md border border-poke-border p-3">
              <input
                id={id}
                type="radio"
                name={`${idPrefix}-share`}
                value={value}
                checked={selected === value}
                disabled={reason !== null && selected !== value}
                aria-describedby={`${id}-help`}
                onChange={() => onSelect(value)}
                className="mt-1 h-4 w-4 shrink-0 accent-poke-accent"
              />
              <div className="min-w-0">
                <label htmlFor={id} className="block text-sm font-semibold text-poke-text-primary">
                  {text(`toolbar.visibility.${value}`)}
                </label>
                <p id={`${id}-help`} className="text-sm text-poke-text-muted">
                  {text(`share.${value}Help`)}
                  {reason !== null && selected !== value && ` ${text(`share.${reason}`)}`}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>

      {locked !== null && <p className="text-sm text-poke-text-muted">{text(`share.${locked}`)}</p>}
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {text('save.cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} disabled={locked !== null || unchanged || disabledFor(selected) !== null} onClick={onApply}>
          {text('share.apply')}
        </Button>
      </div>
    </div>
  );
}

interface ShareDialogProps {
  text: ShellText;
  idPrefix: string;
  open: boolean;
  onClose: () => void;
  actor: StudioActor;
  definition: DefinitionAccess;
  hasPublished: boolean;
  /** The studio's visibility route (`PATCH` with the chosen visibility). */
  request: (visibility: StudioVisibility) => Promise<ApiOutcome<VisibilityChanged>>;
  /** The visibility changed on the server. */
  onChanged: (visibility: StudioVisibility) => void;
}

/** The share dialog: picks a visibility and sends it. The result shows in the toolbar. */
export default function ShareDialog({ text, idPrefix, open, onClose, actor, definition, hasPublished, request, onChanged }: ShareDialogProps) {
  const [selected, setSelected] = useState<StudioVisibility>(definition.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await request(selected);
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
    <Modal open={open} onClose={busy ? () => undefined : onClose} size="md" title={text('share.title')}>
      <ShareDialogBody
        text={text}
        idPrefix={idPrefix}
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
