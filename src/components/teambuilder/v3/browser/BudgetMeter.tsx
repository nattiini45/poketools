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
    <div className="px-3 py-2 border-b border-hairline bg-surface shrink-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-caption text-fg-muted">{t('budgetMeter.label')}</span>
        <span
          className={`text-caption font-mono font-medium ${
            overBudget ? 'text-loss' : remaining <= 5 ? 'text-accent-ink' : 'text-fg'
          }`}
        >
          {remaining >= 0 ? remaining : `−${Math.abs(remaining)}`} / {draft.budget}
        </span>
      </div>
      <div className="h-1.5 bg-hairline rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            overBudget ? 'bg-loss' : pct > 85 ? 'bg-tier-2' : 'bg-accent-fill'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overBudget && (
        <p className="text-caption text-loss mt-0.5">{t('budgetMeter.over', { amount: Math.abs(remaining) })}</p>
      )}
    </div>
  );
}
