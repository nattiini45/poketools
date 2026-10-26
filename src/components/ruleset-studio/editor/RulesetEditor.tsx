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
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import type { RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { canDeleteDefinition, type RulesetActor } from '@/lib/ruleset-studio/access';
import { classifyApiError, deleteRulesetRequest, forkRulesetRequest, publishRequest, saveDraftRequest, visibilityRequest } from '@/lib/ruleset-studio/editor/api';
import { blankDocument, normalizeDraft, type DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { publishGate } from '@/lib/ruleset-studio/editor/preview';
import { SECTION_HEADING_ID, isListSection, type EditorSection } from '@/lib/ruleset-studio/editor/targets';
import type { RulesetDefinitionSummary, RulesetVisibility } from '@/lib/ruleset-studio/library-types';
import { resolveLText } from '@/lib/studio-core/ltext';
import { applyPatch, type JsonValue } from '@/lib/studio-core/patch';
import { RULESETS_HREF, rulesetEditorHref, rulesetReadOnlyHref } from '../hrefs';
import BaseSection from '../sections/BaseSection';
import ClausesSection from '../sections/ClausesSection';
import ConstraintsSection from '../sections/ConstraintsSection';
import ListSection from '../sections/ListSection';
import NotesSection from '../sections/NotesSection';
import SummaryPanel from '../summary/SummaryPanel';
import OutlineNav from './OutlineNav';
import PublishSummary from './PublishSummary';
import { useRulesetEditor } from './useRulesetEditor';

export interface RulesetEditorProps {
  definitionId: string;
  /** Slug, visibility, kind, owner (id and name only) and the newest published version. */
  summary: RulesetDefinitionSummary;
  initial: { document: unknown; draftRev: number };
  published: { versionNo: number; contentHash: string; resolvedHash: string } | null;
  /** The viewer; `leagueIds` is the league that owns this ruleset when the viewer administers it. */
  actor: { playerId: string; isAdmin: boolean; leagueIds: string[] };
  /** The resolved rules of the draft's base preset, read on the server so the first paint needs no request. */
  initialPreset: PresetRules | null;
}

type DialogId = 'publish' | 'share' | 'fork' | 'delete' | 'conflict';

function toActor(actor: RulesetEditorProps['actor']): RulesetActor {
  return { playerId: actor.playerId, isAdmin: actor.isAdmin, leagueIds: new Set(actor.leagueIds) };
}

/** A name for the blank replacement of an unreadable draft: the old name when it can be read. */
function nameForReplacement(raw: unknown, locale: 'en' | 'de', fallback: string): string {
  const identity = typeof raw === 'object' && raw !== null ? (raw as { identity?: unknown }).identity : undefined;
  const name = typeof identity === 'object' && identity !== null ? (identity as { name?: unknown }).name : undefined;
  if (typeof name === 'object' && name !== null) {
    const resolved = resolveLText(name as Parameters<typeof resolveLText>[0], { viewer: locale })?.value;
    if (resolved !== undefined && resolved !== '') return resolved.slice(0, 120);
  }
  return fallback;
}

/**
 * A draft the form cannot show (hand-written through the API): the structural reasons in plain words, the draft as a
 * JSON download, and an explicit, confirmed way to start over with a blank ruleset at the same revision.
 */
function UnreadableDraft({ definitionId, raw, revision }: { definitionId: string; raw: unknown; revision: number }) {
  const t = useT(rulesetStudioSectionsMessages);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const issues = useMemo(() => {
    const parsed = normalizeDraft(raw);
    return parsed.ok ? [] : parsed.issues.slice(0, 20);
  }, [raw]);
  const json = useMemo(() => JSON.stringify(raw ?? null, null, 2), [raw]);

  const replace = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await saveDraftRequest(definitionId, revision, blankDocument(nameForReplacement(raw, locale, t('shape.blankName')), locale));
      setConfirming(false);
      if (outcome.ok) router.refresh();
      else setError(outcome.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="rf-shape-title">
      <Alert variant="error">
        <h2 id="rf-shape-title" className="font-heading font-semibold">
          {t('shape.title')}
        </h2>
        <p className="mt-1">{t('shape.body')}</p>
      </Alert>
      {issues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-secondary">
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.code}`} className="break-all">
              {t('shape.issue', { path: issue.path === '' ? '/' : issue.path, code: issue.code })}
            </li>
          ))}
        </ul>
      )}
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
          download="ruleset-draft.json"
          className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
        >
          {t('shape.download')}
        </a>
        <Button type="button" variant="danger" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setConfirming(true)}>
          {t('shape.replaceBlank')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void replace()}
        title={t('shape.replaceBlank')}
        message={t('shape.replaceConfirm')}
        confirmLabel={t('shape.replaceBlank')}
        loading={busy}
      />
    </section>
  );
}

/**
 * The Ruleset Studio editor: one wide page. Sections on the left, the active section in the centre (the picker for the
 * four lists), the live summary with undo and redo on the right. A draft that normalizes opens as the form; one that does
 * not gets the error panel. Saving is explicit (the button and Ctrl/Cmd+S), publishing and sharing go through the
 * shared studio dialogs, and a save that finds a newer revision opens the conflict dialog.
 */
export default function RulesetEditor(props: RulesetEditorProps) {
  const normalised = useMemo(() => normalizeDraft(props.initial.document), [props.initial.document]);
  if (!normalised.ok) {
    return <UnreadableDraft definitionId={props.definitionId} raw={props.initial.document} revision={props.initial.draftRev} />;
  }
  return <LoadedEditor {...props} initialDoc={normalised.doc} />;
}

function LoadedEditor({ definitionId, summary, initial, published: initialPublished, actor: actorProps, initialPreset, initialDoc }: RulesetEditorProps & { initialDoc: DraftDocument }) {
  const text = useShellText(rulesetStudioEditorMessages);
  const t = useT(rulesetStudioSectionsMessages);
  const locale = useLocale();
  const router = useRouter();
  const actor = useMemo(() => toActor(actorProps), [actorProps]);

  const model = useRulesetEditor({ definitionId, initialDoc, initialRev: initial.draftRev, initialPreset });
  const { state, dirty } = model;
  const doc = state.doc;
  const section = state.selection.section;

  const [published, setPublished] = useState(initialPublished);
  const [visibility, setVisibility] = useState<RulesetVisibility>(summary.visibility);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [actionError, setActionError] = useState<ApiErrorLike | null>(null);
  const [deleting, setDeleting] = useState(false);
  const skipGuard = useUnsavedGuard(dirty, text('save.guardConfirm'));

  useEffect(() => {
    if (state.save.status === 'conflict') setDialog('conflict');
  }, [state.save.status]);

  const access = useMemo(
    () => ({ kind: summary.kind, owner_id: summary.owner?.id ?? null, visibility, season_id: summary.season_id }),
    [summary.kind, summary.owner, summary.season_id, visibility],
  );
  const canDelete = canDeleteDefinition(actor, access);

  const publishResult = useMemo(() => (dialog === 'publish' ? model.compileNow(doc) : null), [dialog, doc, model]);
  const gate = useMemo(() => (publishResult === null ? null : publishGate(publishResult, published)), [publishResult, published]);

  const name = resolveLText(doc.identity.name, { viewer: locale })?.value ?? resolveLText(summary.name, { viewer: locale })?.value ?? '';

  const save = async () => {
    const outcome = await model.save();
    if (outcome === 'conflict') setDialog('conflict');
  };

  const select = (next: EditorSection) => {
    model.select({ section: next });
    revealInspector(SECTION_HEADING_ID);
  };

  const applyFix = (diagnostic: RulesetDiagnostic) => {
    if (diagnostic.fix === undefined) return;
    const patched = applyPatch(model.latest().doc as unknown as JsonValue, diagnostic.fix);
    if (!patched.ok) return;
    const normalised = normalizeDraft(patched.value);
    if (normalised.ok) model.replaceDocument(normalised.doc);
  };

  const removeDraft = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      const outcome = await deleteRulesetRequest(definitionId);
      if (outcome.ok) {
        skipGuard.current = true;
        router.push(RULESETS_HREF);
      } else {
        setDialog(null);
        setActionError(outcome.error);
      }
    } finally {
      setDeleting(false);
    }
  };

  let content: ReactElement;
  switch (section) {
    case 'base':
      content = (
        <BaseSection
          doc={doc}
          preset={model.preset}
          presetStatus={model.presetStatus}
          onRetryPreset={model.retryPreset}
          loadPreset={model.loadPreset}
          onChange={model.edit}
          onReplace={model.replaceDocument}
        />
      );
      break;
    case 'clauses':
      content = <ClausesSection doc={doc} preset={model.preset} generation={model.frame.gen} onToggle={model.setClauseOn} />;
      break;
    case 'constraints':
      content = <ConstraintsSection doc={doc} onChange={model.edit} />;
      break;
    case 'notes':
      content = <NotesSection doc={doc} onChange={model.edit} />;
      break;
    default:
      content = isListSection(section) ? <ListSection key={section} category={section} model={model} /> : <></>;
  }

  return (
    <EditorLayout
      rootAttribute="data-ruleset-editor"
      wide
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
          backHref={RULESETS_HREF}
          readOnlyHref={rulesetReadOnlyHref(definitionId)}
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
      outline={<OutlineNav doc={doc} selected={section} diagnostics={model.result.diagnostics} onSelect={select} />}
      main={
        <section aria-labelledby={SECTION_HEADING_ID} className="min-w-0 space-y-4">
          <h2 id={SECTION_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold text-poke-text-primary focus:outline-none">
            {t(`outline.${section}`)}
          </h2>
          {content}
          <p role="status" aria-live="polite" className="sr-only">
            {model.announcement}
          </p>
        </section>
      }
      side={<SummaryPanel model={model} onSelectSection={select} onApplyFix={applyFix} />}
    >
      {publishResult !== null && gate !== null && (
        <PublishDialog
          text={text}
          idPrefix="rf"
          open={dialog === 'publish'}
          onClose={() => setDialog(null)}
          summary={<PublishSummary result={publishResult} nameOf={model.nameOf} />}
          gate={gate}
          errorCount={publishResult.diagnostics.filter((d) => d.severity === 'error').length}
          dirty={dirty}
          publishedVersion={published?.versionNo ?? null}
          authorBase={locale}
          readOnlyHref={rulesetReadOnlyHref(definitionId)}
          save={model.save}
          latest={model.latest}
          publish={(rev, changelog) => publishRequest(definitionId, rev, changelog)}
          classify={classifyApiError}
          onPublished={(version) => setPublished({ ...version, resolvedHash: publishResult.resolved_hash ?? '' })}
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
        idPrefix="rf"
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
        request={() => forkRulesetRequest(definitionId)}
        onForked={(newId) => {
          skipGuard.current = true;
          router.push(rulesetEditorHref(newId));
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
