'use client';

import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import type { LevelRuleEntry } from '@/lib/ruleset-kit/types';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';

interface LevelsSectionProps {
  doc: DraftDocument;
  onChange: (next: DraftDocument) => void;
}

/** Configures the default level and per-species approved or experimental overrides. */
export default function LevelsSection({ doc, onChange }: LevelsSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const levels = doc.levels;
  if (levels === null) {
    return (
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-poke-text-secondary">{t('levels.intro')}</p>
        <Button type="button" variant="secondary" onClick={() => onChange({ ...doc, levels: { policy: 'max', default: 100, entries: [] } })}>
          {t('levels.enable')}
        </Button>
      </div>
    );
  }

  const update = (index: number, patch: Partial<LevelRuleEntry>) => {
    onChange({ ...doc, levels: { ...levels, entries: levels.entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry) } });
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
        <Input
          id={fieldId('/levels/default')}
          type="number"
          min={1}
          max={100}
          step={1}
          label={t('levels.default')}
          value={levels.default}
          onChange={(event) => {
            const value = Math.trunc(Number(event.target.value));
            onChange({ ...doc, levels: { ...levels, default: Number.isFinite(value) ? Math.min(100, Math.max(1, value)) : 100 } });
          }}
        />
      </div>
      <p className="text-xs text-poke-text-muted">{t('levels.defaultHelp')}</p>
      <div className="space-y-3">
        <h3 className="font-heading text-base font-bold text-poke-text-primary">{t('levels.entries')}</h3>
        {levels.entries.length === 0 && <p className="text-sm text-poke-text-muted">{t('levels.empty')}</p>}
        {levels.entries.map((entry, index) => (
          <div key={index} className="grid items-end gap-3 rounded-poke-md border border-poke-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_auto]">
            <Input
              id={fieldId(`/levels/entries/${index}/id`)}
              label={t('levels.species')}
              value={entry.id}
              onChange={(event) => update(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100) })}
            />
            <Input
              id={fieldId(`/levels/entries/${index}/level`)}
              type="number"
              min={1}
              max={100}
              step={1}
              label={t('levels.level')}
              value={entry.level}
              onChange={(event) => {
                const value = Math.trunc(Number(event.target.value));
                update(index, { level: Number.isFinite(value) ? Math.min(100, Math.max(1, value)) : 100 });
              }}
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
            <Button type="button" variant="ghost" onClick={() => onChange({ ...doc, levels: { ...levels, entries: levels.entries.filter((_, i) => i !== index) } })}>
              {t('levels.remove')}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={levels.entries.length >= 256}
            onClick={() => onChange({ ...doc, levels: { ...levels, entries: [...levels.entries, { id: '', level: levels.default, status: 'experimental' }] } })}
          >
            {t('levels.add')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onChange({ ...doc, levels: null })}>{t('levels.disable')}</Button>
        </div>
      </div>
    </div>
  );
}
