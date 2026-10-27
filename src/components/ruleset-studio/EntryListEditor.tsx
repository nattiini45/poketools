'use client';

import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import type { CatalogScope } from '@/lib/pkmn/catalog-index';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { applyListAction } from '@/lib/ruleset-studio/editor/picker/list-edit';
import { KIND_OF, displayNameOf } from '@/lib/ruleset-studio/editor/picker/display';
import EntryPicker from './picker/EntryPicker';
import { useEntryIndex } from './picker/usePickerData';

interface EntryListEditorProps {
  category: RulesetCategory;
  /** The field's label (it also titles the dialog). */
  label: string;
  /** The listed entry ids (`toID` of the English names). Storage-agnostic: the caller converts from and to its own shape. */
  value: readonly string[];
  onChange: (ids: readonly string[]) => void;
  /** The generation whose entries the picker lists. */
  gen?: number;
  scope?: CatalogScope;
  doubles?: boolean;
  /** The most chips shown before "and N more". */
  maxChips?: number;
  /**
   * English names for ids, used until the catalog has loaded and for ids it does not know. A caller whose storage keeps names
   * passes them here, so its chips read "Baton Pass" at once and an unknown entry keeps its spelling instead of its id.
   */
  nameHints?: Readonly<Record<string, string>>;
}

const DEFAULT_MAX_CHIPS = 12;

/**
 * A plain list of entries (banned moves, banned items) as chips with an "Edit list…" button that opens the entry picker in a
 * dialog: the same search, facets, sprites, bulk actions and keyboard model as the ruleset editor, for a place that
 * stores just a list. An id the catalog does not know stays in the list and shows as an unknown entry, so nothing a stored
 * list holds is dropped silently.
 */
export default function EntryListEditor({ category, label, value, onChange, gen = 9, scope = 'standard', doubles = false, maxChips = DEFAULT_MAX_CHIPS, nameHints }: EntryListEditorProps) {
  const t = useT(rulesetStudioPickerMessages);
  const dataLocale = useDataLocale();
  const [open, setOpen] = useState(false);
  const kind = KIND_OF[category];
  const { state } = useEntryIndex({ kind, gen, scope, preset: null });
  const index = state.status === 'ready' ? state.index : null;

  const nameOf = (id: string): string => {
    const english = index?.byId.get(id)?.name ?? nameHints?.[id];
    return english === undefined ? id : displayNameOf(kind, english, dataLocale);
  };
  const shown = value.slice(0, maxChips);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading text-sm font-semibold text-poke-text-primary">
          {label} <span className="font-normal text-poke-text-muted">({t('entryList.count', { count: value.length })})</span>
        </p>
        <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t('entryList.edit')}
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('entryList.empty')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {shown.map((id) => {
            const known = index === null || index.byId.has(id);
            const name = nameOf(id);
            return (
              <li key={id} className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-semibold ${known ? 'border-poke-border bg-poke-surface text-poke-text-primary' : 'border-dashed border-poke-border-strong bg-poke-muted text-poke-text-secondary'}`}>
                <span title={known ? undefined : t('entryList.unknown', { name })}>{name}</span>
                <button
                  type="button"
                  aria-label={t('entryList.remove', { name })}
                  onClick={() => onChange(applyListAction(value, 'reset', [id]))}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-poke-text-muted hover:bg-poke-muted hover:text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {value.length > shown.length && <li className="self-center text-xs text-poke-text-muted">{t('entryList.more', { count: value.length - shown.length })}</li>}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="xl" title={t('entryList.title', { label })}>
        <div className="space-y-4">
          <EntryPicker
            category={category}
            rules={{ ban: [...value], unban: [], allow: null }}
            base={null}
            gen={gen}
            scope={scope}
            doubles={doubles}
            presetId={null}
            history={{ canUndo: false, canRedo: false, onUndo: () => undefined, onRedo: () => undefined }}
            onAct={(action, ids) => onChange(applyListAction(value, action, ids))}
          />
          <div className="flex justify-end">
            <Button type="button" variant="primary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setOpen(false)}>
              {t('entryList.done')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
