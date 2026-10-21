'use client';

import { useEditorContext } from '../editor/EditorContext';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

export default function BudgetMeter() {
  const t = useT(teambuilderMessages);
  const { state } = useEditorContext();
  const draft = state.draft;

  if (!draft || draft.budget === null) return null;

  const spent = draft.spent ?? 0;
  const remaining = draft.budget - spent;
  const pct = Math.min(100, (spent / draft.budget) * 100);
  const overBudget = spent > draft.budget;

  return (
    <div className="px-3 py-2 border-b border-poke-border bg-poke-surface shrink-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-poke-text-muted uppercase tracking-wide">{t('budgetMeter.label')}</span>
        <span
          className={`text-[11px] font-mono font-medium ${
            overBudget ? 'text-red-400' : remaining <= 5 ? 'text-yellow-400' : 'text-poke-text-primary'
          }`}
        >
          {remaining >= 0 ? remaining : `−${Math.abs(remaining)}`} / {draft.budget}
        </span>
      </div>
      <div className="h-1.5 bg-poke-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            overBudget ? 'bg-red-500' : pct > 85 ? 'bg-yellow-400' : 'bg-poke-blue'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overBudget && (
        <p className="text-[9px] text-red-400 mt-0.5">{t('budgetMeter.over', { amount: Math.abs(remaining) })}</p>
      )}
    </div>
  );
}
