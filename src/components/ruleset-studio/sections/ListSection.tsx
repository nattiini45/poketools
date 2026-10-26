'use client';

import { useState, type KeyboardEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { categoryCounts } from '@/lib/ruleset-kit/changes';
import { isLegalState, stateLookup } from '@/lib/ruleset-kit/entry-state';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { cn } from '@/lib/utils/cn';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';
import type { BulkAction } from '@/lib/ruleset-studio/editor/picker/bulk';
import { KIND_OF } from '@/lib/ruleset-studio/editor/picker/display';
import EntryPicker from '../picker/EntryPicker';
import { useEntryIndex } from '../picker/usePickerData';
import type { RulesetEditorModel } from '../editor/useRulesetEditor';

interface ListSectionProps {
  category: RulesetCategory;
  model: RulesetEditorModel;
}

const MODES = ['block', 'allow'] as const;

interface AllowlistStartProps {
  category: RulesetCategory;
  model: RulesetEditorModel;
  onDone: () => void;
}

/**
 * The question the allowlist switch asks: start empty, or with everything that is legal right now. The legal entries come
 * from the same catalog the picker shows (one shared request), so the button waits until it has loaded.
 */
function AllowlistStart({ category, model, onDone }: AllowlistStartProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const { frame } = model;
  const { state } = useEntryIndex({ kind: KIND_OF[category], gen: frame.gen, scope: frame.scope, preset: frame.rosterPreset });
  const lookup = stateLookup(model.state.doc[category], model.baseList(category));
  const legalIds = state.status === 'ready' ? state.index.entries.filter((entry) => isLegalState(lookup.stateOf(entry.id))).map((entry) => entry.id) : null;
  return (
    <div role="group" aria-label={t('lists.startWith')} className="space-y-2 rounded-poke-md border border-poke-border bg-poke-surface p-3">
      <p className="text-sm font-semibold text-poke-text-primary">{t('lists.startWith')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 sm:min-h-0"
          onClick={() => {
            onDone();
            model.setListMode(category, 'allow');
          }}
        >
          {t('lists.startEmpty')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="min-h-11 sm:min-h-0"
          disabled={legalIds === null}
          onClick={() => {
            onDone();
            model.setListMode(category, 'allow', legalIds ?? []);
          }}
        >
          {legalIds === null ? t('lists.startNotReady') : t('lists.startLegal', { count: legalIds.length })}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onDone}>
          {t('lists.startCancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * One of the four list sections (Pokémon, moves, items, abilities): a mode switch between the block list and an
 * allowlist, the counters against the preset, a reset to the preset, and the entry picker. The same component serves all
 * four categories. The allowlist switch asks how to start it: empty, or with everything that is legal right now, so
 * the author never has to rebuild a whole format by hand.
 */
export default function ListSection({ category, model }: ListSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const doc = model.state.doc;
  const rules = doc[category];
  const base = model.baseList(category);
  const allowlist = rules.allow !== null;
  const counts = categoryCounts(rules, base);
  const [starting, setStarting] = useState(false);
  const { frame } = model;

  const onModeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    choose(allowlist ? 'block' : 'allow');
    requestAnimationFrame(() => document.getElementById(`rf-mode-${category}-${allowlist ? 'block' : 'allow'}`)?.focus());
  };

  const choose = (mode: (typeof MODES)[number]) => {
    if (mode === 'block') {
      setStarting(false);
      model.setListMode(category, 'block');
    } else if (!allowlist) {
      setStarting(true);
    }
  };

  const changeCount = counts.youBanned + counts.youUnbanned;
  const presetWaiting = model.presetStatus === 'loading' || model.presetStatus === 'error';

  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{t(`lists.${category}.intro`)}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="radiogroup" aria-label={t('lists.mode')} className="inline-flex overflow-hidden rounded-poke-md border border-poke-border">
          {MODES.map((mode) => {
            const checked = (mode === 'allow') === allowlist;
            return (
              <button
                key={mode}
                id={`rf-mode-${category}-${mode}`}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => choose(mode)}
                onKeyDown={onModeKey}
                className={cn(
                  'min-h-11 px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9',
                  checked ? 'bg-poke-accent text-poke-surface' : 'bg-poke-surface text-poke-text-secondary hover:bg-poke-muted',
                )}
              >
                {mode === 'block' ? t('lists.block') : t('lists.allow')}
              </button>
            );
          })}
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-poke-text-secondary">
          {allowlist ? (
            <li>{t('lists.counts.allowed', { count: counts.allowed ?? 0 })}</li>
          ) : (
            <>
              {base !== null && <li>{t('lists.counts.preset', { count: counts.baseCount })}</li>}
              <li>{t('lists.counts.banned', { count: counts.youBanned })}</li>
              <li>{t('lists.counts.unbanned', { count: counts.youUnbanned })}</li>
            </>
          )}
        </ul>

        {!allowlist && changeCount > 0 && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => model.resetList(category)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('lists.resetCount', { count: changeCount })}
          </Button>
        )}
      </div>

      {starting && !allowlist && (
        <AllowlistStart category={category} model={model} onDone={() => setStarting(false)} />
      )}

      {allowlist && (
        <Alert variant="info" id={fieldId(`/${category}/allow`)}>
          {rules.allow !== null && rules.allow.length === 0 ? t('lists.allowEmpty') : t('lists.allowIgnored')}
        </Alert>
      )}

      {presetWaiting ? (
        <Alert variant={model.presetStatus === 'error' ? 'error' : 'info'} className="flex flex-wrap items-center justify-between gap-2">
          <span role="status">{model.presetStatus === 'error' ? t('base.presetFailed') : t('base.presetLoading')}</span>
          {model.presetStatus === 'error' && (
            <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={model.retryPreset}>
              {t('base.retry')}
            </Button>
          )}
        </Alert>
      ) : (
        <EntryPicker
          category={category}
          rules={rules}
          base={base}
          gen={frame.gen}
          scope={frame.scope}
          doubles={frame.doubles}
          presetId={frame.rosterPreset}
          history={{ canUndo: model.canUndo, canRedo: model.canRedo, onUndo: model.undo, onRedo: model.redo }}
          onAct={(action: BulkAction, ids) => model.act(category, action, ids)}
        />
      )}
    </div>
  );
}
