'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { MAX_STAGES, ptr, resolveLText, type Diagnostic } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { issuesUnder } from '@/lib/format-studio/editor/preview';
import type { Selection } from '@/lib/format-studio/editor/targets';
import { cn } from '@/lib/utils/cn';
import ReorderControls, { useMoveFocus } from './fields/ReorderControls';

const PANEL_ID = 'fe-outline-panel';

interface OutlineNavProps {
  doc: DraftDocument;
  selection: Selection;
  diagnostics: readonly Diagnostic[];
  onSelect: (selection: Selection) => void;
  onAddStage: () => void;
  onMoveStage: (from: number, to: number) => void;
  onDuplicateStage: (index: number) => void;
  onDeleteStage: (index: number) => void;
}

const ITEM =
  'flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-poke-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9';

/**
 * The outline of the format: its name and look, the stages (with reorder, duplicate and delete), the
 * advancement rules, the honor rules and the rules text. Below `lg` it folds into one button that names the
 * current selection; choosing an item folds it again. A moved stage keeps focus on the button that moved it, and
 * the new position is announced in a polite status region.
 */
export default function OutlineNav({ doc, selection, diagnostics, onSelect, onAddStage, onMoveStage, onDuplicateStage, onDeleteStage }: OutlineNavProps) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const moveFocus = useMoveFocus();

  const stageName = (index: number): string => {
    const stage = doc.stages[index];
    if (stage === undefined) return t('outline.untitled');
    return resolveLText(stage.name, { viewer: locale })?.value ?? t('outline.untitled');
  };

  const isSelected = (section: Selection['section'], index = 0) =>
    selection.section === section && (section !== 'stage' || selection.index === index);

  const currentLabel = (() => {
    switch (selection.section) {
      case 'identity':
        return t('outline.identity');
      case 'theme':
        return t('outline.look');
      case 'edges':
        return t('outline.advancement');
      case 'rules':
        return t('outline.honor');
      case 'text':
        return t('outline.rulesText');
      default:
        return stageName(selection.index);
    }
  })();

  const choose = (next: Selection) => {
    setOpen(false);
    onSelect(next);
  };

  const issueBadge = (prefix: string) => {
    const count = issuesUnder(diagnostics, prefix).length;
    return count > 0 ? (
      <Badge variant="yellow" size="xs" className="shrink-0">
        {t('outline.issues', { count })}
      </Badge>
    ) : null;
  };

  const item = (section: Selection['section'], index: number, label: string, prefix: string, count?: number) => (
    <button
      type="button"
      aria-current={isSelected(section, index) ? 'true' : undefined}
      className={cn(ITEM, isSelected(section, index) ? 'border-poke-accent bg-poke-accent-light font-semibold text-poke-text-primary' : 'border-transparent hover:bg-poke-elevated')}
      onClick={() => choose({ section, index })}
    >
      <span className="min-w-0 break-words">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {count !== undefined && <span className="text-xs text-poke-text-muted">{count}</span>}
        {issueBadge(prefix)}
      </span>
    </button>
  );

  // Two stages may share a key in a broken draft; the list still needs distinct React keys.
  const seen = new Set<string>();
  const rowKeys = doc.stages.map((stage, i) => {
    const key = seen.has(stage.key) ? `${stage.key}#${i}` : stage.key;
    seen.add(key);
    return key;
  });

  const stagesFull = doc.stages.length >= MAX_STAGES;
  const caption = 'px-1 pb-1 font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-muted';

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-poke-md border border-poke-border bg-poke-elevated px-3 py-2 text-left text-sm font-semibold text-poke-text-primary lg:hidden"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 break-words">{t('outline.toggle', { current: currentLabel })}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      <nav id={PANEL_ID} aria-label={t('outline.label')} className={cn(open ? 'block' : 'hidden', 'mt-2 space-y-4 lg:mt-0 lg:block')}>
        <div>
          <p id="fe-outline-format" className={caption}>
            {t('outline.format')}
          </p>
          <ul aria-labelledby="fe-outline-format" className="space-y-1">
            <li>{item('identity', 0, t('outline.identity'), '/identity')}</li>
            <li>{item('theme', 0, t('outline.look'), '/theme')}</li>
          </ul>
        </div>

        <div>
          <p id="fe-outline-stages" className={caption}>
            {t('outline.stages')}
          </p>
          <ul aria-labelledby="fe-outline-stages" className="space-y-2">
            {doc.stages.map((stage, i) => {
              const name = stageName(i);
              return (
                <li key={rowKeys[i]} className="space-y-1">
                  {item('stage', i, name, ptr('stages', i))}
                  <ReorderControls
                    className="px-1"
                    index={i}
                    count={doc.stages.length}
                    rowKey={rowKeys[i]}
                    labels={{
                      up: t('outline.moveUp', { name }),
                      down: t('outline.moveDown', { name }),
                      duplicate: t('outline.duplicate', { name }),
                      remove: t('outline.delete', { name }),
                    }}
                    duplicateDisabled={stagesFull}
                    onMove={(to, direction) => {
                      onMoveStage(i, to);
                      moveFocus.mark(to, direction);
                      setAnnouncement(t('outline.moved', { name, position: to + 1, total: doc.stages.length }));
                    }}
                    onDuplicate={() => onDuplicateStage(i)}
                    onRemove={() => setPendingDelete(i)}
                    focusDirection={moveFocus.focusFor(i)}
                    onFocusHandled={moveFocus.clear}
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-2 space-y-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 w-full sm:min-h-0"
              disabled={stagesFull}
              aria-describedby={stagesFull ? 'fe-limit-stages' : undefined}
              onClick={onAddStage}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('outline.addStage')}
            </Button>
            {stagesFull && (
              <p id="fe-limit-stages" className="text-xs text-poke-text-muted">
                {t('outline.limitStages', { max: MAX_STAGES })}
              </p>
            )}
          </div>
        </div>

        <ul className="space-y-1" aria-label={t('outline.rulesGroup')}>
          <li>{item('edges', 0, t('outline.advancement'), '/edges', doc.edges.length)}</li>
          <li>{item('rules', 0, t('outline.honor'), '/rules', doc.rules.length)}</li>
          <li>{item('text', 0, t('outline.rulesText'), '/text', doc.text.sections.length)}</li>
        </ul>
      </nav>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) onDeleteStage(pendingDelete);
          setPendingDelete(null);
        }}
        title={t('outline.deleteTitle', { name: pendingDelete === null ? '' : stageName(pendingDelete) })}
        message={t('outline.deleteBody')}
        confirmLabel={t('outline.deleteConfirm')}
      />
    </div>
  );
}
