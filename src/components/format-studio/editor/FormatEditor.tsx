'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import ConflictDialog from '@/components/studio-shell/dialogs/ConflictDialog';
import DeleteDialog from '@/components/studio-shell/dialogs/DeleteDialog';
import ForkDialog from '@/components/studio-shell/dialogs/ForkDialog';
import PublishDialog from '@/components/studio-shell/dialogs/PublishDialog';
import ShareDialog from '@/components/studio-shell/dialogs/ShareDialog';
import EditorLayout, { ActionErrorAlert, SaveErrorAlert, revealInspector } from '@/components/studio-shell/EditorLayout';
import EditorToolbar from '@/components/studio-shell/EditorToolbar';
import { useShellText } from '@/components/studio-shell/text';
import { useUnsavedGuard } from '@/components/studio-shell/useUnsavedGuard';
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
import { classifyApiError, deleteFormatRequest, forkFormatRequest, publishRequest, saveDraftRequest, visibilityRequest } from '@/lib/format-studio/editor/api';
import { blankDocument, normalizeDraft, type DraftDocument } from '@/lib/format-studio/editor/document';
import type { RulesetChoice } from '@/lib/format-studio/editor/catalog';
import { addStage, duplicateStage, moveStage, removeStage } from '@/lib/format-studio/editor/ops';
import { compileDraft, publishGate } from '@/lib/format-studio/editor/preview';
import type { Selection } from '@/lib/format-studio/editor/targets';
import type { FormatDefinitionSummary, FormatVisibility } from '@/lib/format-studio/library-types';
import DiagnosticsList from '../DiagnosticsList';
import PublishSummary from './dialogs/PublishSummary';
import { INSPECTOR_HEADING_ID } from './fields/FieldMessage';
import { FORMATS_HREF, formatEditorHref, formatReadOnlyHref } from './hrefs';
import EdgesInspector from './inspectors/EdgesInspector';
import IdentityInspector from './inspectors/IdentityInspector';
import RulesInspector from './inspectors/RulesInspector';
import StageInspector from './inspectors/StageInspector';
import OutlineNav from './OutlineNav';
import PreviewPanel from './preview/PreviewPanel';
import { useFormatEditor } from './useFormatEditor';

export interface FormatEditorProps {
  definitionId: string;
  /** Slug, visibility, kind, owner (id and name only) and the newest published version. */
  summary: FormatDefinitionSummary;
  initial: { document: unknown; draftRev: number };
  published: { versionNo: number; contentHash: string } | null;
  actor: FormatActor;
  rulesets: RulesetChoice[];
  /** False when unknown; the API refuses a delete of an attached format anyway. */
  hasAttachments: boolean;
}

type DialogId = 'publish' | 'share' | 'fork' | 'delete' | 'conflict';

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
  rulesets: RulesetChoice[];
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
  const text = useShellText(formatStudioEditorMessages);
  const locale = useLocale();
  const router = useRouter();

  const rulesetIds = useMemo(() => new Set(rulesets.map((r) => r.id)), [rulesets]);
  const model = useFormatEditor({ definitionId, initialDoc, initialRev: initial.draftRev, rulesetIds });
  const { state, dirty } = model;
  const doc = state.doc;

  const [published, setPublished] = useState(initialPublished);
  const [visibility, setVisibility] = useState<FormatVisibility>(summary.visibility);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [actionError, setActionError] = useState<ApiErrorLike | null>(null);
  const [deleting, setDeleting] = useState(false);
  const skipGuard = useUnsavedGuard(dirty, text('save.guardConfirm'));

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

  const select = (selection: Selection) => {
    model.select(selection);
    revealInspector(INSPECTOR_HEADING_ID);
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
        router.push(FORMATS_HREF);
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
    <EditorLayout
      rootAttribute="data-format-editor"
      dirty={dirty}
      onSave={() => void save()}
      toolbar={
        <EditorToolbar
          text={text}
          name={name}
          save={state.save}
          dirty={dirty}
          counts={model.counts}
          visibility={visibility}
          publishedVersion={published?.versionNo ?? null}
          canDelete={canDelete}
          backHref={FORMATS_HREF}
          readOnlyHref={formatReadOnlyHref(definitionId)}
          onSave={() => void save()}
          onPublish={() => setDialog('publish')}
          onShare={() => setDialog('share')}
          onFork={() => setDialog('fork')}
          onDelete={() => setDialog('delete')}
        />
      }
      banners={
        <>
          <SaveErrorAlert text={text} save={state.save} onRetry={() => void save()} />
          <ActionErrorAlert error={actionError} />
        </>
      }
      outline={
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
      }
      main={inspector}
      side={
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
      }
    >
      {publishResult !== null && gate !== null && (
        <PublishDialog
          text={text}
          idPrefix="fe"
          open={dialog === 'publish'}
          onClose={() => setDialog(null)}
          summary={<PublishSummary doc={doc} result={publishResult} />}
          gate={gate}
          errorCount={publishResult.diagnostics.filter((d) => d.severity === 'error').length}
          dirty={dirty}
          publishedVersion={published?.versionNo ?? null}
          authorBase={locale}
          readOnlyHref={formatReadOnlyHref(definitionId)}
          save={model.save}
          latest={model.latest}
          publish={(rev, changelog) => publishRequest(definitionId, rev, changelog)}
          classify={classifyApiError}
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
        text={text}
        idPrefix="fe"
        open={dialog === 'share'}
        onClose={() => setDialog(null)}
        actor={actor}
        definition={access}
        hasPublished={published !== null}
        request={(next) => visibilityRequest(definitionId, next)}
        onChanged={setVisibility}
      />
      <ForkDialog
        text={text}
        open={dialog === 'fork'}
        onClose={() => setDialog(null)}
        request={() => forkFormatRequest(definitionId)}
        onForked={(newId) => {
          skipGuard.current = true;
          router.push(formatEditorHref(newId));
        }}
      />
      <DeleteDialog text={text} open={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={() => void removeDraft()} loading={deleting} />
      <ConflictDialog
        text={text}
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
    </EditorLayout>
  );
}
