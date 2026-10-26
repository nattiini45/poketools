'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLocale, useT } from '@/i18n/client';
import { createTranslator } from '@/i18n/core';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import { resolveLText, type Diagnostic, type Locale } from '@/lib/format-kit/client';
import { canDeleteDefinition, type FormatActor } from '@/lib/format-studio/access';
import { deleteFormatRequest, saveDraftRequest } from '@/lib/format-studio/editor/api';
import { blankDocument, normalizeDraft, type DraftDocument } from '@/lib/format-studio/editor/document';
import { addStage, duplicateStage, moveStage, removeStage } from '@/lib/format-studio/editor/ops';
import { compileDraft, publishGate } from '@/lib/format-studio/editor/preview';
import type { Selection } from '@/lib/format-studio/editor/targets';
import type { FormatDefinitionSummary, FormatVisibility } from '@/lib/format-studio/library-types';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import DiagnosticsList from '../DiagnosticsList';
import ConflictDialog from './dialogs/ConflictDialog';
import ForkDialog from './dialogs/ForkDialogBody';
import PublishDialog from './dialogs/PublishDialog';
import ShareDialog from './dialogs/ShareDialog';
import EditorToolbar from './EditorToolbar';
import { INSPECTOR_HEADING_ID } from './fields/FieldMessage';
import EdgesInspector from './inspectors/EdgesInspector';
import IdentityInspector from './inspectors/IdentityInspector';
import RulesInspector from './inspectors/RulesInspector';
import StageInspector from './inspectors/StageInspector';
import OutlineNav from './OutlineNav';
import PreviewPanel from './preview/PreviewPanel';
import { useFormatEditor } from './useFormatEditor';
import { useUnsavedGuard } from './useUnsavedGuard';

export interface FormatEditorProps {
  definitionId: string;
  /** Slug, visibility, kind, owner (id and name only) and the newest published version. */
  summary: FormatDefinitionSummary;
  initial: { document: unknown; draftRev: number };
  published: { versionNo: number; contentHash: string } | null;
  actor: FormatActor;
  rulesets: { id: string; name: string }[];
  /** False when unknown; the API refuses a delete of an attached format anyway. */
  hasAttachments: boolean;
}

type DialogId = 'publish' | 'share' | 'fork' | 'delete' | 'conflict';

const BACK_HREF = '/admin/formats';

/** The suffix a duplicated stage's name gets, in each language. */
function copySuffixes(): Partial<Record<Locale, string>> {
  return {
    en: createTranslator(formatStudioEditorMessages, 'en')('outline.copySuffix'),
    de: createTranslator(formatStudioEditorMessages, 'de')('outline.copySuffix'),
  };
}

/** A name for the blank replacement of an unreadable draft: the old name when it can be read. */
function nameForReplacement(raw: unknown, locale: Locale, fallback: string): string {
  const identity = typeof raw === 'object' && raw !== null ? (raw as { identity?: unknown }).identity : undefined;
  const name = typeof identity === 'object' && identity !== null ? (identity as { name?: unknown }).name : undefined;
  if (typeof name === 'object' && name !== null) {
    const resolved = resolveLText(name as Parameters<typeof resolveLText>[0], { viewer: locale })?.value;
    if (resolved !== undefined && resolved !== '') return resolved.slice(0, 120);
  }
  return fallback;
}

interface InspectorArgs {
  selection: Selection;
  doc: DraftDocument;
  diagnostics: readonly Diagnostic[];
  onChange: (next: DraftDocument) => void;
  authorBase: Locale;
  rulesets: { id: string; name: string }[];
  /** The line for a stage selection that points at no stage. */
  noStageText: string;
}

/**
 * The inspector for the selected part of the form. The stage inspector is keyed by the stage's index: it sits at
 * the same place in the tree for every stage, and its local state (an open key draft, the rank step kind to add)
 * belongs to the stage it was started on, so it must not follow the selection to another stage.
 */
export function inspectorFor({ selection, doc, diagnostics, onChange, authorBase, rulesets, noStageText }: InspectorArgs): ReactElement {
  const { section, index } = selection;
  const common = { doc, diagnostics, onChange, authorBase };
  switch (section) {
    case 'identity':
      return <IdentityInspector {...common} part="identity" />;
    case 'theme':
      return <IdentityInspector {...common} part="theme" />;
    case 'edges':
      return <EdgesInspector doc={doc} diagnostics={diagnostics} onChange={onChange} />;
    case 'rules':
      return <RulesInspector {...common} part="rules" />;
    case 'text':
      return <RulesInspector {...common} part="text" />;
    default:
      return doc.stages[index] === undefined ? (
        <p className="text-sm text-poke-text-muted">{noStageText}</p>
      ) : (
        <StageInspector key={index} {...common} index={index} rulesets={rulesets} />
      );
  }
}

/**
 * A draft the form cannot show (hand-written through the API): the reasons in plain words, the draft as a JSON
 * download, and an explicit, confirmed way to start over with a blank format at the same revision.
 */
function UnreadableDraft({ definitionId, raw, revision }: { definitionId: string; raw: unknown; revision: number }) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const diagnostics = useMemo(() => compileDraft(raw).diagnostics, [raw]);
  const json = useMemo(() => JSON.stringify(raw ?? null, null, 2), [raw]);

  const replace = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await saveDraftRequest(definitionId, revision, blankDocument(nameForReplacement(raw, locale, t('save.blankName')), locale));
      if (outcome.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setConfirming(false);
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="fe-shape-title">
      <Alert variant="error">
        <h2 id="fe-shape-title" className="font-heading font-semibold">
          {t('save.shapeTitle')}
        </h2>
        <p className="mt-1">{t('save.shapeBody')}</p>
      </Alert>
      <DiagnosticsList diagnostics={diagnostics} definition={null} />
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
          download="format-draft.json"
          className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
        >
          {t('save.download')}
        </a>
        <Button type="button" variant="danger" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setConfirming(true)}>
          {t('save.replaceBlank')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void replace()}
        title={t('save.replaceBlank')}
        message={t('save.replaceConfirm')}
        confirmLabel={t('save.replaceBlank')}
        loading={busy}
      />
    </section>
  );
}

/**
 * The format editor. A draft that normalises opens as a form (outline, inspector and live preview); one that
 * does not gets the error panel. Everything the editor does is a pure operation on the document plus a request
 * through the library API; saving is explicit (the button and Ctrl/Cmd+S), and a save that finds a newer
 * revision opens the conflict dialog.
 */
export default function FormatEditor(props: FormatEditorProps) {
  const normalised = useMemo(() => normalizeDraft(props.initial.document), [props.initial.document]);
  if (!normalised.ok) {
    return <UnreadableDraft definitionId={props.definitionId} raw={props.initial.document} revision={props.initial.draftRev} />;
  }
  return <LoadedEditor {...props} initialDoc={normalised.doc} />;
}

function LoadedEditor({ definitionId, summary, initial, published: initialPublished, actor, rulesets, hasAttachments, initialDoc }: FormatEditorProps & { initialDoc: DraftDocument }) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);

  const rulesetIds = useMemo(() => new Set(rulesets.map((r) => r.id)), [rulesets]);
  const model = useFormatEditor({ definitionId, initialDoc, initialRev: initial.draftRev, rulesetIds });
  const { state, dirty } = model;
  const doc = state.doc;

  const [published, setPublished] = useState(initialPublished);
  const [visibility, setVisibility] = useState<FormatVisibility>(summary.visibility);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [actionError, setActionError] = useState<ApiErrorLike | null>(null);
  const [deleting, setDeleting] = useState(false);
  const skipGuard = useUnsavedGuard(dirty, t('save.guardConfirm'));

  useEffect(() => {
    if (state.save.status === 'conflict') setDialog('conflict');
  }, [state.save.status]);

  const access = useMemo(
    () => ({ kind: summary.kind, owner_id: summary.owner?.id ?? null, visibility }),
    [summary.kind, summary.owner, visibility],
  );
  const canDelete = canDeleteDefinition(actor, access) && published === null && !hasAttachments;

  const publishResult = useMemo(() => (dialog === 'publish' ? compileDraft(doc, rulesetIds) : null), [dialog, doc, rulesetIds]);
  const gate = useMemo(() => (publishResult === null ? null : publishGate(publishResult, published?.contentHash ?? null)), [publishResult, published]);

  const name = resolveLText(doc.identity.name, { viewer: locale })?.value ?? resolveLText(summary.name, { viewer: locale })?.value ?? '';

  const save = async () => {
    const outcome = await model.save();
    if (outcome === 'conflict') setDialog('conflict');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  const select = (selection: Selection) => {
    model.select(selection);
    // Below `lg` the outline sits above the inspector: bring the reader to the heading of what they chose.
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      window.requestAnimationFrame(() => document.getElementById(INSPECTOR_HEADING_ID)?.focus());
    }
  };

  const selectedStage = state.selection.section === 'stage' ? state.selection.index : null;

  const onAddStage = () => {
    const result = addStage(doc, { after: selectedStage ?? undefined });
    if (result.index < 0) return;
    model.edit(result.doc);
    select({ section: 'stage', index: result.index });
  };
  const onDuplicateStage = (index: number) => {
    const result = duplicateStage(doc, index, copySuffixes());
    if (result.index < 0) return;
    model.edit(result.doc);
    select({ section: 'stage', index: result.index });
  };
  const onDeleteStage = (index: number) => {
    const { doc: next } = removeStage(doc, index);
    model.edit(next);
    if (next.stages.length === 0) {
      model.select({ section: 'identity', index: 0 });
    } else if (selectedStage !== null) {
      const target = selectedStage > index ? selectedStage - 1 : selectedStage;
      model.select({ section: 'stage', index: Math.min(target, next.stages.length - 1) });
    }
  };
  const onMoveStage = (from: number, to: number) => {
    model.edit(moveStage(doc, from, to));
    if (selectedStage === null) return;
    if (selectedStage === from) model.select({ section: 'stage', index: to });
    else if (from < selectedStage && selectedStage <= to) model.select({ section: 'stage', index: selectedStage - 1 });
    else if (to <= selectedStage && selectedStage < from) model.select({ section: 'stage', index: selectedStage + 1 });
  };

  const removeDraft = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      const outcome = await deleteFormatRequest(definitionId);
      if (outcome.ok) {
        skipGuard.current = true;
        router.push(BACK_HREF);
      } else {
        setDialog(null);
        setActionError(outcome.error);
      }
    } finally {
      setDeleting(false);
    }
  };

  const inspector = inspectorFor({
    selection: state.selection,
    doc,
    diagnostics: model.result.diagnostics,
    onChange: model.edit,
    authorBase: locale,
    rulesets,
    noStageText: t('inspector.stage.noStage'),
  });

  return (
    <div className="min-w-0 space-y-4" data-format-editor="" {...unsavedMarker(dirty)} onKeyDown={onKeyDown}>
      <EditorToolbar
        name={name}
        save={state.save}
        dirty={dirty}
        counts={model.counts}
        visibility={visibility}
        publishedVersion={published?.versionNo ?? null}
        canDelete={canDelete}
        backHref={BACK_HREF}
        readOnlyHref={`/admin/formats/${encodeURIComponent(definitionId)}`}
        onSave={() => void save()}
        onPublish={() => setDialog('publish')}
        onShare={() => setDialog('share')}
        onFork={() => setDialog('fork')}
        onDelete={() => setDialog('delete')}
      />

      {state.save.status === 'error' && (
        <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {t('save.failed')} {errorText(state.save.error)}
          </span>
          <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => void save()}>
            {t('save.retry')}
          </Button>
        </Alert>
      )}
      {actionError !== null && <Alert variant="error">{errorText(actionError)}</Alert>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
        <aside className="min-w-0">
          <OutlineNav
            doc={doc}
            selection={state.selection}
            diagnostics={model.result.diagnostics}
            onSelect={select}
            onAddStage={onAddStage}
            onMoveStage={onMoveStage}
            onDuplicateStage={onDuplicateStage}
            onDeleteStage={onDeleteStage}
          />
        </aside>
        <div className="min-w-0">{inspector}</div>
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <PreviewPanel
            doc={doc}
            previewDoc={model.previewDoc}
            result={model.result}
            rows={model.rows}
            counts={model.counts}
            rulesets={rulesets}
            rulesetIds={rulesetIds}
            onEdit={model.edit}
            onSelect={select}
          />
        </div>
      </div>

      {publishResult !== null && gate !== null && (
        <PublishDialog
          open={dialog === 'publish'}
          onClose={() => setDialog(null)}
          definitionId={definitionId}
          doc={doc}
          result={publishResult}
          gate={gate}
          dirty={dirty}
          publishedVersion={published?.versionNo ?? null}
          authorBase={locale}
          save={model.save}
          latest={model.latest}
          onPublished={(version) => setPublished(version)}
          onConflict={(staleRev) => {
            // A publish can meet the newer revision before any save did: record it, so the dialog names it.
            model.markConflict(staleRev);
            setDialog('conflict');
          }}
        />
      )}
      <ShareDialog
        key={visibility}
        open={dialog === 'share'}
        onClose={() => setDialog(null)}
        definitionId={definitionId}
        actor={actor}
        definition={access}
        hasPublished={published !== null}
        onChanged={setVisibility}
      />
      <ForkDialog
        open={dialog === 'fork'}
        onClose={() => setDialog(null)}
        definitionId={definitionId}
        onForked={(newId) => {
          skipGuard.current = true;
          router.push(`/admin/formats/${encodeURIComponent(newId)}/edit`);
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        onConfirm={() => void removeDraft()}
        title={t('delete.title')}
        message={t('delete.body')}
        confirmLabel={t('delete.confirm')}
        loading={deleting}
      />
      <ConflictDialog
        open={dialog === 'conflict'}
        serverRev={state.save.status === 'conflict' ? state.save.serverRev : state.rev}
        dirty={dirty}
        onReload={async () => {
          const outcome = await model.reload();
          if (outcome.ok) return null;
          return outcome.reason === 'request' ? outcome.error : { code: 'unknown_error' };
        }}
        onKeepMine={() => {
          const serverRev = state.save.status === 'conflict' ? state.save.serverRev : state.rev;
          model.keepMine();
          setDialog(null);
          void model.save({ rev: serverRev, force: true });
        }}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
