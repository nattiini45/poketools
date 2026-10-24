'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import {
  MAX_EDGES,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_SELECTS,
  printExpr,
  ptr,
  resolveLText,
  type AdvanceSelect,
  type Diagnostic,
  type Edge,
} from '@/lib/format-kit/client';
import { EDGE_GATES, EDGE_SEEDINGS, SELECT_KINDS_EDITABLE } from '@/lib/format-studio/editor/catalog';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { addEdge, addSelect, moveEdge, patchSelect, removeEdge, removeSelect, updateEdge } from '@/lib/format-studio/editor/ops';
import { FieldIssuesProvider, INSPECTOR_HEADING_ID, PointerMessage } from '../fields/FieldMessage';
import NumberField from '../fields/NumberField';
import ReorderControls, { useMoveFocus } from '../fields/ReorderControls';
import SelectField, { type SelectOption } from '../fields/SelectField';

interface EdgesInspectorProps {
  doc: DraftDocument;
  diagnostics: readonly Diagnostic[];
  onChange: (next: DraftDocument) => void;
}

type EditableKind = (typeof SELECT_KINDS_EDITABLE)[number];

const isEditable = (select: AdvanceSelect): select is Exclude<AdvanceSelect, { kind: 'threshold' }> => select.kind !== 'threshold';

/** One selection of an advancement rule: its kind and number, or the read-only condition of a threshold. */
function SelectionRow({
  edgeIndex,
  position,
  select,
  onKind,
  onNumber,
  onRemove,
}: {
  edgeIndex: number;
  position: number;
  select: AdvanceSelect;
  onKind: (kind: EditableKind) => void;
  onNumber: (value: number | undefined) => void;
  onRemove: () => void;
}) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const base = ptr('edges', edgeIndex, 'select', position);
  const n = position + 1;

  return (
    <li className="flex min-w-0 flex-wrap items-end gap-3 rounded-poke-md border border-poke-border bg-poke-elevated p-3">
      {isEditable(select) ? (
        <>
          <SelectField
            className="min-w-0 flex-1 basis-48"
            pointer={ptr('edges', edgeIndex, 'select', position, 'kind')}
            label={t('inspector.edges.selection', { position: n })}
            value={select.kind}
            options={SELECT_KINDS_EDITABLE.map((kind) => ({ value: kind, label: p.dynamic(`label.advance_${kind}`) }))}
            onChange={(value) => onKind(value as EditableKind)}
          />
          {select.kind === 'manual_list' ? (
            <NumberField
              className="min-w-0 flex-1 basis-28"
              pointer={ptr('edges', edgeIndex, 'select', position, 'count')}
              label={t('inspector.edges.handPickedCount')}
              value={select.count}
              min={1}
              max={MAX_N}
              optional
              onCommit={onNumber}
            />
          ) : (
            <NumberField
              className="min-w-0 flex-1 basis-28"
              pointer={ptr('edges', edgeIndex, 'select', position, 'n')}
              label={t('inspector.edges.amount')}
              value={select.n}
              min={1}
              max={select.kind === 'per_group' ? MAX_N_PER_GROUP : MAX_N}
              onCommit={onNumber}
            />
          )}
        </>
      ) : (
        <div className="min-w-0 flex-1 basis-full space-y-1">
          <p className="text-sm font-semibold text-poke-text-primary">{p('label.advance_threshold')}</p>
          <code className="block break-words rounded bg-poke-muted px-2 py-1 text-sm">{printExpr(select.when)}</code>
          <p className="text-sm text-poke-text-muted">{t('inspector.edges.thresholdReadOnly')}</p>
        </div>
      )}
      <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={onRemove}>
        {t('inspector.edges.removeSelection', { position: n })}
      </Button>
      <PointerMessage pointer={base} className="basis-full" />
    </li>
  );
}

/** The add control of a rule's selections: a kind select and an Add button that explains the limit. */
function AddSelection({ edgeIndex, full, onAdd }: { edgeIndex: number; full: boolean; onAdd: (kind: EditableKind) => void }) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const [kind, setKind] = useState<EditableKind>('top_n');
  const limitId = `fe-limit-selections-${edgeIndex}`;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SelectField
        className="min-w-0 basis-56"
        pointer={ptr('edges', edgeIndex, 'select', 'add')}
        label={t('inspector.edges.addSelectionKind')}
        value={kind}
        disabled={full}
        options={SELECT_KINDS_EDITABLE.map((value) => ({ value, label: p.dynamic(`label.advance_${value}`) }))}
        onChange={(value) => setKind(value as EditableKind)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-11 sm:min-h-0"
        disabled={full}
        aria-describedby={full ? limitId : undefined}
        onClick={() => onAdd(kind)}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('inspector.edges.addSelection')}
      </Button>
      {full && (
        <p id={limitId} className="text-sm text-poke-text-muted">
          {t('inspector.edges.limitSelections', { max: MAX_SELECTS })}
        </p>
      )}
    </div>
  );
}

/**
 * The advancement rules: who moves from which stage to which. Stages are picked by name, each rule has up to
 * four selections (a number each), a seeding and a confirmation. A threshold selection (a condition) can be read
 * and removed here, but is edited by the builder that comes later.
 */
export default function EdgesInspector({ doc, diagnostics, onChange }: EdgesInspectorProps) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const locale = useLocale();
  const moveFocus = useMoveFocus();
  const [announcement, setAnnouncement] = useState('');

  const stageName = (key: string) => {
    const stage = doc.stages.find((s) => s.key === key);
    return stage === undefined ? key : (resolveLText(stage.name, { viewer: locale })?.value ?? key);
  };
  const stageOptions = (current: string): SelectOption[] => {
    const options: SelectOption[] = doc.stages.map((s) => ({ value: s.key, label: stageName(s.key) }));
    if (!doc.stages.some((s) => s.key === current)) options.unshift({ value: current, label: current });
    return options;
  };

  const edges = doc.edges;
  const full = edges.length >= MAX_EDGES;
  const canAdd = doc.stages.length >= 2;

  const add = () => {
    const result = addEdge(doc, { from: doc.stages[0]?.key, to: doc.stages[1]?.key });
    if (result.index >= 0) onChange(result.doc);
  };

  return (
    <FieldIssuesProvider diagnostics={diagnostics} definition={doc}>
      <div className="min-w-0 space-y-4" data-inspector="edges">
        <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold text-poke-text-primary focus:outline-none">
          {t('inspector.edges.heading')}
        </h2>
        <p className="text-sm text-poke-text-secondary">{t('inspector.edges.intro')}</p>
        {!canAdd && <p className="text-sm text-poke-text-muted">{t('inspector.edges.needTwoStages')}</p>}
        {canAdd && edges.length === 0 && <p className="text-sm text-poke-text-muted">{t('inspector.edges.none')}</p>}

        <ol className="space-y-4" aria-label={t('inspector.edges.heading')}>
          {edges.map((edge, i) => {
            const base = ptr('edges', i);
            const update = (fn: (e: Edge) => Edge) => onChange(updateEdge(doc, i, fn));
            const title = `${stageName(edge.from)} → ${stageName(edge.to)}`;
            return (
              <li key={edge.key} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="min-w-0 break-words font-heading text-base font-semibold text-poke-text-primary">{title}</h3>
                  <ReorderControls
                    index={i}
                    count={edges.length}
                    rowKey={edge.key}
                    labels={{
                      up: t('inspector.edges.moveUp', { name: title }),
                      down: t('inspector.edges.moveDown', { name: title }),
                      remove: t('inspector.edges.remove', { name: title }),
                    }}
                    onMove={(to, direction) => {
                      onChange(moveEdge(doc, i, to));
                      moveFocus.mark(to, direction);
                      setAnnouncement(t('inspector.edges.moved', { name: title, position: to + 1, total: edges.length }));
                    }}
                    onRemove={() => onChange(removeEdge(doc, i))}
                    focusDirection={moveFocus.focusFor(i)}
                    onFocusHandled={moveFocus.clear}
                  />
                </div>
                <PointerMessage pointer={base} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    pointer={ptr('edges', i, 'from')}
                    label={p('field.from')}
                    value={edge.from}
                    options={stageOptions(edge.from)}
                    onChange={(value) => update((e) => ({ ...e, from: value }))}
                  />
                  <SelectField
                    pointer={ptr('edges', i, 'to')}
                    label={p('field.to')}
                    value={edge.to}
                    options={stageOptions(edge.to)}
                    onChange={(value) => update((e) => ({ ...e, to: value }))}
                  />
                </div>

                <div className="space-y-2">
                  <h4 className="font-heading text-sm font-semibold text-poke-text-primary">{t('inspector.edges.selections')}</h4>
                  <ul className="space-y-2">
                    {edge.select.map((select, j) => (
                      <SelectionRow
                        key={j}
                        edgeIndex={i}
                        position={j}
                        select={select}
                        onKind={(kind) => update((e) => patchSelect(e, j, { kind }))}
                        onNumber={(value) =>
                          update((e) => patchSelect(e, j, select.kind === 'manual_list' ? { count: value } : value === undefined ? {} : { n: value }))
                        }
                        onRemove={() => update((e) => removeSelect(e, j))}
                      />
                    ))}
                  </ul>
                  <AddSelection edgeIndex={i} full={edge.select.length >= MAX_SELECTS} onAdd={(kind) => update((e) => addSelect(e, kind))} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    pointer={ptr('edges', i, 'seeding')}
                    label={p('field.seeding')}
                    value={edge.seeding}
                    options={EDGE_SEEDINGS.map((value) => ({ value, label: p.dynamic(`option.seeding_${value}`) }))}
                    onChange={(value) => update((e) => ({ ...e, seeding: value as Edge['seeding'] }))}
                  />
                  <SelectField
                    pointer={ptr('edges', i, 'gate')}
                    label={p('field.gate')}
                    value={edge.gate}
                    options={EDGE_GATES.map((value) => ({ value, label: p.dynamic(`option.gate_${value}`) }))}
                    onChange={(value) => update((e) => ({ ...e, gate: value as Edge['gate'] }))}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        <p role="status" className="sr-only">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 sm:min-h-0"
            disabled={!canAdd || full}
            aria-describedby={full ? 'fe-limit-edges' : undefined}
            onClick={add}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('inspector.edges.add')}
          </Button>
          {full && (
            <p id="fe-limit-edges" className="text-sm text-poke-text-muted">
              {t('inspector.edges.limitEdges', { max: MAX_EDGES })}
            </p>
          )}
        </div>
      </div>
    </FieldIssuesProvider>
  );
}
