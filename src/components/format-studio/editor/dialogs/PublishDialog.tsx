'use client';

import Link from 'next/link';
import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import { useLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import {
  LTEXT_MAX_CHARS,
  computeCoverage,
  describeCoverage,
  ltext,
  renderDiagnostic,
  type CompileResult,
  type Diagnostic,
  type FormatDefinition,
  type LText,
  type Locale,
} from '@/lib/format-kit/client';
import { classifyApiError, publishRequest, type FetchLike } from '@/lib/format-studio/editor/api';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import type { publishGate } from '@/lib/format-studio/editor/preview';
import type { EditorState } from '@/lib/format-studio/editor/state';
import type { SaveOutcome } from '../useFormatEditor';

export interface Changelog {
  en: string;
  de: string;
}

/** The changelog as stored text: only the languages with text, based on the author's language when it has some. */
export function changelogText(changelog: Changelog, authorBase: Locale): LText | undefined {
  const en = changelog.en.trim();
  const de = changelog.de.trim();
  if (en === '' && de === '') return undefined;
  const base: Locale = authorBase === 'en' ? (en !== '' ? 'en' : 'de') : de !== '' ? 'de' : 'en';
  return ltext(base, en === '' ? undefined : en, de === '' ? undefined : de);
}

/** How a publish attempt ended: the dialog maps each outcome to its own state change. */
export type PublishFlowOutcome =
  | { kind: 'published'; version: { versionNo: number; contentHash: string } }
  /** A save or the publish found a newer revision; `staleRev` is the server's, when the response named it. */
  | { kind: 'conflict'; staleRev?: number }
  | { kind: 'failed'; error: ApiErrorLike };

interface PublishFlowArgs {
  definitionId: string;
  dirty: boolean;
  changelog: Changelog;
  authorBase: Locale;
  save: () => Promise<SaveOutcome>;
  latest: () => EditorState;
  fetchImpl?: FetchLike;
}

/**
 * The publish sequence without any rendering: save unsaved changes first, then publish the saved revision.
 * A stale revision (from the save or from the publish) is a conflict, with the server's revision when known.
 */
export async function runPublishFlow({ definitionId, dirty, changelog, authorBase, save, latest, fetchImpl }: PublishFlowArgs): Promise<PublishFlowOutcome> {
  if (dirty) {
    const saved = await save();
    if (saved === 'conflict') return { kind: 'conflict' };
    if (saved === 'failed' || saved === 'busy') {
      const failure = latest().save;
      return { kind: 'failed', error: failure.status === 'error' ? failure.error : { code: 'unknown_error' } };
    }
  }
  const outcome = await publishRequest(definitionId, latest().rev, changelogText(changelog, authorBase), fetchImpl);
  if (outcome.ok) {
    return { kind: 'published', version: { versionNo: outcome.data.version.version_no, contentHash: outcome.data.version.content_hash } };
  }
  const classified = classifyApiError(outcome.error, outcome.status);
  if (classified.kind === 'stale_revision') return classified.staleRev === undefined ? { kind: 'conflict' } : { kind: 'conflict', staleRev: classified.staleRev };
  return { kind: 'failed', error: outcome.error };
}

interface PublishDialogBodyProps {
  /** The draft as it is now, and its compile. */
  doc: DraftDocument;
  result: CompileResult;
  gate: ReturnType<typeof publishGate>;
  /** The draft has unsaved changes: they are saved first. */
  dirty: boolean;
  /** The number the new version will get. */
  nextVersion: number;
  /** The newest published version, for the "nothing changed" message. */
  publishedVersion: number | null;
  changelog: Changelog;
  onChangelog: (next: Changelog) => void;
  busy: boolean;
  error: ApiErrorLike | null;
  /** Set after a successful publish. */
  doneVersion: number | null;
  readOnlyHref: string;
  onPublish: () => void;
  onClose: () => void;
}

function Findings({ heading, items, doc }: { heading: string; items: readonly Diagnostic[]; doc: FormatDefinition }) {
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{heading}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-secondary">
        {items.map((d, i) => (
          <li key={`${d.code}:${d.json_pointer}:${i}`} className="break-words">
            {renderDiagnostic(d, locale, doc)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What a publish will do: the compile result in plain sentences (errors block, warnings do not), the coverage
 * line, the version number, an optional changelog in both languages and the Publish button. Presentational: the
 * dialog around it owns the state and the requests.
 */
export function PublishDialogBody({
  doc,
  result,
  gate,
  dirty,
  nextVersion,
  publishedVersion,
  changelog,
  onChangelog,
  busy,
  error,
  doneVersion,
  readOnlyHref,
  onPublish,
  onClose,
}: PublishDialogBodyProps) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  const notes = result.diagnostics.filter((d) => d.severity === 'info');
  const blockedText =
    gate.reason === 'errors'
      ? t('publish.blocked', { count: errors.length })
      : gate.reason === 'nothing_new'
        ? t('publish.nothingNew', { n: publishedVersion ?? 0 })
        : null;

  if (doneVersion !== null) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-semibold text-poke-text-primary">
          {t('publish.done', { n: doneVersion })}
        </p>
        <p className="text-sm text-poke-text-secondary">{t('publish.shareHint')}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={readOnlyHref} className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0">
            {t('publish.openReadOnly')}
          </Link>
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            {t('publish.close')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{t('publish.creates', { n: nextVersion })}</p>
      <Findings heading={t('publish.errorsHeading', { count: errors.length })} items={errors} doc={doc} />
      <Findings heading={t('publish.warningsHeading', { count: warnings.length })} items={warnings} doc={doc} />
      {notes.length > 0 && <p className="text-sm text-poke-text-muted">{t('publish.notes', { count: notes.length })}</p>}
      {errors.length === 0 && <p className="text-sm text-poke-text-secondary">{describeCoverage(computeCoverage(doc), locale)}</p>}

      {dirty && <p className="text-sm text-poke-text-muted">{t('publish.savesFirst')}</p>}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-poke-text-primary">{t('publish.changelog')}</p>
        <Textarea
          id="fe-changelog-en"
          label={t('publish.changelogEn')}
          lang="en"
          rows={2}
          maxLength={LTEXT_MAX_CHARS}
          value={changelog.en}
          onChange={(event) => onChangelog({ ...changelog, en: event.target.value })}
        />
        <Textarea
          id="fe-changelog-de"
          label={t('publish.changelogDe')}
          lang="de"
          rows={2}
          maxLength={LTEXT_MAX_CHARS}
          value={changelog.de}
          onChange={(event) => onChangelog({ ...changelog, de: event.target.value })}
        />
      </div>

      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {blockedText !== null && (
          <p id="fe-publish-reason" className="mr-auto text-sm text-poke-text-muted">
            {blockedText}
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t('save.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!gate.allowed}
          aria-describedby={blockedText !== null ? 'fe-publish-reason' : undefined}
          onClick={onPublish}
        >
          {t('publish.confirm')}
        </Button>
      </div>
    </div>
  );
}

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  definitionId: string;
  doc: DraftDocument;
  result: CompileResult;
  gate: ReturnType<typeof publishGate>;
  dirty: boolean;
  publishedVersion: number | null;
  authorBase: Locale;
  /** The editor's save (publishing saves unsaved changes first) and its latest state (revision, save error). */
  save: () => Promise<SaveOutcome>;
  latest: () => EditorState;
  /** A version was published. */
  onPublished: (version: { versionNo: number; contentHash: string }) => void;
  /** A save or the publish found a newer revision on the server: the conflict dialog takes over. */
  onConflict: (staleRev?: number) => void;
  fetchImpl?: FetchLike;
}

/**
 * The publish dialog: shows what will be published, saves unsaved changes first, then publishes the saved
 * revision. A stale revision hands over to the conflict dialog; every other failure is shown inside the dialog.
 */
export default function PublishDialog({
  open,
  onClose,
  definitionId,
  doc,
  result,
  gate,
  dirty,
  publishedVersion,
  authorBase,
  save,
  latest,
  onPublished,
  onConflict,
  fetchImpl,
}: PublishDialogProps) {
  const t = useT(formatStudioEditorMessages);
  const [changelog, setChangelog] = useState<Changelog>({ en: '', de: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [doneVersion, setDoneVersion] = useState<number | null>(null);
  const nextVersion = (publishedVersion ?? 0) + 1;

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runPublishFlow({ definitionId, dirty, changelog, authorBase, save, latest, fetchImpl });
      if (outcome.kind === 'published') {
        setDoneVersion(outcome.version.versionNo);
        onPublished(outcome.version);
      } else if (outcome.kind === 'conflict') {
        onClose();
        onConflict(outcome.staleRev);
      } else {
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
    setError(null);
    setDoneVersion(null);
  };

  return (
    <Modal open={open} onClose={close} size="lg" title={doneVersion === null ? t('publish.title', { n: nextVersion }) : t('publish.doneTitle')}>
      <PublishDialogBody
        doc={doc}
        result={result}
        gate={gate}
        dirty={dirty}
        nextVersion={nextVersion}
        publishedVersion={publishedVersion}
        changelog={changelog}
        onChangelog={setChangelog}
        busy={busy}
        error={error}
        doneVersion={doneVersion}
        readOnlyHref={`/admin/formats/${encodeURIComponent(definitionId)}`}
        onPublish={() => void publish()}
        onClose={close}
      />
    </Modal>
  );
}
