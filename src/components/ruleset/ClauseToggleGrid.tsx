'use client';

import { ALL_CLAUSES } from '@/lib/pkmn/format-catalog';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';

interface ClauseToggleGridProps {
  selected: string[];
  onChange: (clauses: string[]) => void;
}

/** Showdown clause names are rule ids and stay English in every language. */
export default function ClauseToggleGrid({ selected, onChange }: ClauseToggleGridProps) {
  const t = useT(rulesetMessages);
  const toggle = (clause: string) => {
    if (selected.includes(clause)) {
      onChange(selected.filter(c => c !== clause));
    } else {
      onChange([...selected, clause]);
    }
  };

  return (
    <div>
      <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-2">{t('clauses.label')}</label>
      <div className="grid grid-cols-2 gap-2">
        {ALL_CLAUSES.map(clause => (
          <label
            key={clause}
            className="flex items-center gap-2 p-2 border border-poke-border rounded-poke-md cursor-pointer hover:bg-poke-elevated transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.includes(clause)}
              onChange={() => toggle(clause)}
              className="rounded accent-poke-accent"
            />
            <span className="text-sm text-poke-text-primary">{clause}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
