'use client';

import { useMemo } from 'react';
import type { CatalogScope } from '@/lib/pkmn/catalog-index';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { toID } from '@/lib/pkmn/i18n/id';
import { idsToNames, namesToIds } from '@/lib/ruleset-studio/editor/names-adapter';
import { KIND_OF } from '@/lib/ruleset-studio/editor/picker/display';
import EntryListEditor from './EntryListEditor';
import { useEntryIndex } from './picker/usePickerData';

interface NameListEditorProps {
  category: RulesetCategory;
  label: string;
  /** The stored list: English display names. */
  value: readonly string[];
  /** The edited list, as English display names again. */
  onChange: (names: string[]) => void;
  gen?: number;
  scope?: CatalogScope;
}

/**
 * `EntryListEditor` for a list that is stored as English names (the draft league's banned moves and items). The picker works on
 * ids; this converts on the way in and out (`names-adapter.ts`): an unknown stored name shows as an "unknown entry" and is kept,
 * a name that was stored keeps its spelling, an added entry is stored as the catalog's English name.
 */
export default function NameListEditor({ category, label, value, onChange, gen = 9, scope = 'standard' }: NameListEditorProps) {
  const { state } = useEntryIndex({ kind: KIND_OF[category], gen, scope, preset: null });
  const index = state.status === 'ready' ? state.index : null;
  const ids = useMemo(() => namesToIds(value), [value]);
  const hints = useMemo(() => Object.fromEntries(value.map((name) => [toID(name), name])), [value]);

  return (
    <EntryListEditor
      category={category}
      label={label}
      value={ids}
      nameHints={hints}
      gen={gen}
      scope={scope}
      onChange={(next) => onChange(idsToNames(next, value, (id) => index?.byId.get(id)?.name))}
    />
  );
}
