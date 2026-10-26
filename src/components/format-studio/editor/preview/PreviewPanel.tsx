'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import type { CompileResult } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import type { IssueRow } from '@/lib/format-studio/editor/preview';
import type { Selection } from '@/lib/format-studio/editor/targets';
import { cn } from '@/lib/utils/cn';
import IssuesTab from './IssuesTab';
import RulesTab from './RulesTab';
import ScheduleTab from './ScheduleTab';

export type PreviewTabId = 'issues' | 'rules' | 'schedule';
const TABS: readonly PreviewTabId[] = ['issues', 'rules', 'schedule'];

interface PreviewPanelProps {
  /** The document being edited: fixes are applied to it. */
  doc: DraftDocument;
  /** The (deferred) document the findings and the other tabs were computed from; defaults to `doc`. */
  previewDoc?: DraftDocument;
  result: CompileResult;
  rows: readonly IssueRow[];
  counts: { errors: number; warnings: number; notes: number };
  rulesets: readonly { id: string; name: string }[];
  rulesetIds: ReadonlySet<string>;
  onEdit: (next: DraftDocument) => void;
  onSelect: (selection: Selection) => void;
  /** For tests: the tab that starts selected. */
  initialTab?: PreviewTabId;
}

/**
 * The live preview of the draft in three tabs: Issues (what is wrong and how to fix it), Rules (the generated
 * rules text) and Schedule (a table of rounds and matches). An ARIA tab list: one tab stop, arrow keys, Home and
 * End move between the tabs and select them. The chosen tab lives in component state only.
 */
export default function PreviewPanel({ doc, previewDoc = doc, result, rows, counts, rulesets, rulesetIds, onEdit, onSelect, initialTab = 'issues' }: PreviewPanelProps) {
  const t = useT(formatStudioEditorMessages);
  const [tab, setTab] = useState<PreviewTabId>(initialTab);
  const refs = useRef<Partial<Record<PreviewTabId, HTMLButtonElement | null>>>({});

  const label = (id: PreviewTabId) => {
    if (id === 'issues') return t('preview.tabs.issues', { count: rows.length });
    return id === 'rules' ? t('preview.tabs.rules') : t('preview.tabs.schedule');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: PreviewTabId) => {
    const at = TABS.indexOf(current);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (at + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next];
    setTab(id);
    refs.current[id]?.focus();
  };

  return (
    <section aria-labelledby="fe-preview-heading" className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border p-4">
      <h2 id="fe-preview-heading" className="font-heading text-lg font-bold text-poke-text-primary">
        {t('preview.label')}
      </h2>
      <div role="tablist" aria-label={t('preview.label')} className="flex flex-wrap gap-1 border-b border-poke-border">
        {TABS.map((id) => (
          <button
            key={id}
            ref={(element) => {
              refs.current[id] = element;
            }}
            type="button"
            role="tab"
            id={`fe-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`fe-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={cn(
              '-mb-px min-h-11 rounded-t-poke-md border-b-2 px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus sm:min-h-9',
              tab === id ? 'border-poke-accent text-poke-text-primary' : 'border-transparent text-poke-text-secondary hover:text-poke-text-primary',
            )}
            onClick={() => setTab(id)}
            onKeyDown={(event) => onKeyDown(event, id)}
          >
            {label(id)}
          </button>
        ))}
      </div>

      {TABS.map((id) => (
        <div key={id} role="tabpanel" id={`fe-panel-${id}`} aria-labelledby={`fe-tab-${id}`} hidden={tab !== id} className="min-w-0">
          {tab === id && id === 'issues' && (
            <IssuesTab doc={doc} diagnostics={result.diagnostics} rows={rows} counts={counts} onEdit={onEdit} onSelect={onSelect} />
          )}
          {tab === id && id === 'rules' && <RulesTab doc={previewDoc} result={result} rulesets={rulesets} />}
          {tab === id && id === 'schedule' && <ScheduleTab doc={previewDoc} rulesetIds={rulesetIds} onShowIssues={() => setTab('issues')} />}
        </div>
      ))}
    </section>
  );
}
