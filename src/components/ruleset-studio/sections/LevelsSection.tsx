'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { MAX_ID_LENGTH, MAX_LEVEL_ENTRIES } from '@/lib/ruleset-kit/limits';
import type { LevelRuleEntry } from '@/lib/ruleset-kit/types';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';

interface LevelsSectionProps {
  doc: DraftDocument;
  onChange: (next: DraftDocument) => void;
}


/** A species id as the document stores it: lower-case letters and digits only. */
const toIdText = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_ID_LENGTH);

type DraftInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'accept'> & {
  /** The committed value. */
  value: string;
  /** Cleans typed text (drops characters that can never be valid). */
  clean: (text: string) => string;
  /** Whether the text is a value the document can hold. Only an accepted text is committed while typing. */
  accept: (text: string) => boolean;
  /** The value a blurred, unaccepted text settles to; null (or no function) restores the committed value. */
  settle?: (text: string) => string | null;
  onCommit: (text: string) => void;
};

/**
 * A text field that edits a DRAFT: an empty or half-typed value (the empty field on the way to a new number, a cleared id)
 * is never written to the document, so the editor never holds a value the document cannot (an empty species id makes the
 * whole document invalid and hides every other diagnostic). It commits the moment the text is acceptable and settles on blur.
 */
function DraftInput({ value, clean, accept, settle, onCommit, ...rest }: DraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      {...rest}
      value={draft ?? value}
      onChange={(event) => {
        const text = clean(event.target.value);
        setDraft(text);
        if (accept(text)) onCommit(text);
      }}
      onBlur={() => {
        if (draft !== null && !accept(draft)) {
          const settled = settle?.(draft) ?? null;
          if (settled !== null && settled !== value) onCommit(settled);
        }
        setDraft(null);
      }}
    />
  );
}

const digits = (text: string): string => text.replace(/\D/g, '').slice(0, 3);
const isLevel = (text: string): boolean => /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= 100;
/** A number out of range settles to the nearest valid level; an empty field restores the value it had. */
const settleLevel = (text: string): string | null => (text === '' ? null : String(Math.min(100, Math.max(1, Number(text)))));

/** Configures the default level and per-species approved or experimental overrides. */
export default function LevelsSection({ doc, onChange }: LevelsSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const [pendingId, setPendingId] = useState('');
  const levels = doc.levels;
  // Removing an entry or the whole rule, and enabling the rules, unmounts the control that has focus; focus then goes
  // to its neighbour (after enabling: the first field of the form), so a keyboard user keeps their place instead of
  // falling back to the top of the page.
  const afterRemove = useRef<{ entry: number } | 'enable' | 'policy' | null>(null);
  const enableRef = useRef<HTMLButtonElement>(null);
  const newSpeciesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const target = afterRemove.current;
    afterRemove.current = null;
    if (target === 'enable') {
      enableRef.current?.focus();
    } else if (target === 'policy') {
      document.getElementById(fieldId('/levels/policy'))?.focus();
    } else if (target !== null) {
      const count = levels?.entries.length ?? 0;
      const index = Math.min(target.entry, count - 1);
      const next = index >= 0 ? document.getElementById(fieldId(`/levels/entries/${index}/id`)) : newSpeciesRef.current;
      next?.focus();
    }
  });
  if (levels === null) {
    return (
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-poke-text-secondary">{t('levels.intro')}</p>
        <Button
          ref={enableRef}
          type="button"
          variant="secondary"
          onClick={() => {
            afterRemove.current = 'policy';
            onChange({ ...doc, levels: { policy: 'max', default: 100, entries: [] } });
          }}
        >
          {t('levels.enable')}
        </Button>
      </div>
    );
  }

  const update = (index: number, patch: Partial<LevelRuleEntry>) => {
    onChange({ ...doc, levels: { ...levels, entries: levels.entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry) } });
  };
  const atCap = levels.entries.length >= MAX_LEVEL_ENTRIES;
  // A new entry exists only once it has an id: an entry without one would make the whole document invalid.
  const addEntry = () => {
    if (pendingId === '' || atCap) return;
    onChange({ ...doc, levels: { ...levels, entries: [...levels.entries, { id: pendingId, level: levels.default, status: 'experimental' }] } });
    setPendingId('');
  };
  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-poke-text-secondary">{t('levels.intro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-poke-text-primary">
          <span>{t('levels.policy')}</span>
          <select
            id={fieldId('/levels/policy')}
            className="min-h-11 w-full rounded-poke-md border border-poke-border bg-poke-surface px-3"
            value={levels.policy}
            onChange={(event) => onChange({ ...doc, levels: { ...levels, policy: event.target.value === 'exact' ? 'exact' : 'max' } })}
          >
            <option value="max">{t('levels.max')}</option>
            <option value="exact">{t('levels.exact')}</option>
          </select>
        </label>
        <DraftInput
          id={fieldId('/levels/default')}
          type="text"
          inputMode="numeric"
          label={t('levels.default')}
          value={String(levels.default)}
          clean={digits}
          accept={isLevel}
          settle={settleLevel}
          onCommit={(text) => onChange({ ...doc, levels: { ...levels, default: Number(text) } })}
        />
      </div>
      <p className="text-xs text-poke-text-muted">{t('levels.defaultHelp')}</p>
      <div className="space-y-3">
        <h3 className="font-heading text-base font-bold text-poke-text-primary">{t('levels.entries')}</h3>
        {levels.entries.length === 0 && <p className="text-sm text-poke-text-muted">{t('levels.empty')}</p>}
        {levels.entries.map((entry, index) => (
          <div key={index} className="grid items-end gap-3 rounded-poke-md border border-poke-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_auto]">
            <DraftInput
              id={fieldId(`/levels/entries/${index}/id`)}
              label={t('levels.species')}
              value={entry.id}
              clean={toIdText}
              accept={(text) => text !== ''}
              onCommit={(text) => update(index, { id: text })}
            />
            <DraftInput
              id={fieldId(`/levels/entries/${index}/level`)}
              type="text"
              inputMode="numeric"
              label={t('levels.level')}
              value={String(entry.level)}
              clean={digits}
              accept={isLevel}
              settle={settleLevel}
              onCommit={(text) => update(index, { level: Number(text) })}
            />
            <label className="space-y-1 text-sm font-medium text-poke-text-primary">
              <span>{t('levels.status')}</span>
              <select
                id={fieldId(`/levels/entries/${index}/status`)}
                className="min-h-11 w-full rounded-poke-md border border-poke-border bg-poke-surface px-3"
                value={entry.status}
                onChange={(event) => update(index, { status: event.target.value === 'approved' ? 'approved' : 'experimental' })}
              >
                <option value="experimental">{t('levels.experimental')}</option>
                <option value="approved">{t('levels.approved')}</option>
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('levels.removeEntry', { species: entry.id })}
              onClick={() => {
                afterRemove.current = { entry: index };
                onChange({ ...doc, levels: { ...levels, entries: levels.entries.filter((_, i) => i !== index) } });
              }}
            >
              {t('levels.remove')}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <Input
            ref={newSpeciesRef}
            label={t('levels.newSpecies')}
            hint={atCap ? t('levels.capReached', { max: MAX_LEVEL_ENTRIES }) : undefined}
            value={pendingId}
            onChange={(event) => setPendingId(toIdText(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addEntry();
              }
            }}
          />
          <Button type="button" variant="secondary" disabled={pendingId === '' || atCap} onClick={addEntry}>
            {t('levels.add')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              afterRemove.current = 'enable';
              onChange({ ...doc, levels: null });
            }}
          >
            {t('levels.disable')}
          </Button>
        </div>
      </div>
    </div>
  );
}
