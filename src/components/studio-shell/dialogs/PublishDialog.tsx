'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { StudioEditorState } from '@/lib/studio-core/editor-state';
import { LTEXT_MAX_CHARS, ltext, type LText, type Locale } from '@/lib/studio-core/ltext';
import type { ApiOutcome, ClassifiedError } from '@/lib/studio-core/request';
import type { SaveOutcome } from '../useDraftEditor';
import type { ShellText } from '../text';

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

/** Whether a draft may be published, and why not (the studio's own gate: errors in the compile, nothing new). */
export interface PublishGate {
  allowed: boolean;
  reason: 'errors' | 'nothing_new' | null;
}

/** The answer of the studio's publish route that the dialog reads. */
export interface PublishedVersion {
  version: { version_no: number; content_hash: string };
}

/** How a publish attempt ended: the dialog maps each outcome to its own state change. */
export type PublishFlowOutcome =
  | { kind: 'published'; version: { versionNo: number; contentHash: string } }
  /** A save or the publish found a newer revision; `staleRev` is the server's, when the response named it. */
  | { kind: 'conflict'; staleRev?: number }
  | { kind: 'failed'; error: ApiErrorLike };

/** The part of the editor state the flow reads. */
type EditorStateView = Pick<StudioEditorState<unknown, unknown>, 'rev' | 'save'>;

interface PublishFlowArgs {
  dirty: boolean;
  changelog: Changelog;
  authorBase: Locale;
  save: () => Promise<SaveOutcome>;
  latest: () => EditorStateView;
  /** The studio's publish route: the revision to publish and the optional changelog. */
  publish: (rev: number, changelog: LText | undefined) => Promise<ApiOutcome<PublishedVersion>>;
  /** The studio's `classifyApiError`. */
  classify: (error: ApiErrorLike, status?: number) => ClassifiedError;
}

/**
 * The publish sequence without any rendering: save unsaved changes first, then publish the saved revision.
 * A stale revision (from the save or from the publish) is a conflict, with the server's revision when known.
 */
export async function runPublishFlow({ dirty, changelog, authorBase, save, latest, publish, classify }: PublishFlowArgs): Promise<PublishFlowOutcome> {
  if (dirty) {
    const saved = await save();
    if (saved === 'conflict') return { kind: 'conflict' };
    if (saved === 'failed' || saved === 'busy') {
      const failure = latest().save;
      return { kind: 'failed', error: failure.status === 'error' ? failure.error : { code: 'unknown_error' } };
    }
  }
  const outcome = await publish(latest().rev, changelogText(changelog, authorBase));
  if (outcome.ok) {
    return { kind: 'published', version: { versionNo: outcome.data.version.version_no, contentHash: outcome.data.version.content_hash } };
  }
  const classified = classify(outcome.error, outcome.status);
  if (classified.kind === 'stale_revision') return classified.staleRev === undefined ? { kind: 'conflict' } : { kind: 'conflict', staleRev: classified.staleRev };
  return { kind: 'failed', error: outcome.error };
}

interface PublishDialogBodyProps {
  text: ShellText;
  /** Prefix of the DOM ids (`fe` for formats). */
  idPrefix: string;
  /** What the publish will do, in the studio's own sentences (the compile findings, a coverage line). */
  summary: ReactNode;
  gate: PublishGate;
  /** The number of errors that block the publish (the blocked reason names it). */
  errorCount: number;
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

/**
 * What a publish will do: the studio's summary of the compile result (errors block, warnings do not), the version
 * number, an optional changelog in both languages and the Publish button. Presentational: the dialog around it owns the
 * state and the requests.
 */
export function PublishDialogBody({
  text,
  idPrefix,
  summary,
  gate,
  errorCount,
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
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const reasonId = `${idPrefix}-publish-reason`;
  const blockedText =
    gate.reason === 'errors'
      ? text('publish.blocked', { count: errorCount })
      : gate.reason === 'nothing_new'
        ? text('publish.nothingNew', { n: publishedVersion ?? 0 })
        : null;

  if (doneVersion !== null) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-semibold text-poke-text-primary">
          {text('publish.done', { n: doneVersion })}
        </p>
        <p className="text-sm text-poke-text-secondary">{text('publish.shareHint')}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={readOnlyHref} className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0">
            {text('publish.openReadOnly')}
          </Link>
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            {text('publish.close')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{text('publish.creates', { n: nextVersion })}</p>
      {summary}

      {dirty && <p className="text-sm text-poke-text-muted">{text('publish.savesFirst')}</p>}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-poke-text-primary">{text('publish.changelog')}</p>
        <Textarea
          id={`${idPrefix}-changelog-en`}
          label={text('publish.changelogEn')}
          lang="en"
          rows={2}
          maxLength={LTEXT_MAX_CHARS}
          value={changelog.en}
          onChange={(event) => onChangelog({ ...changelog, en: event.target.value })}
        />
        <Textarea
          id={`${idPrefix}-changelog-de`}
          label={text('publish.changelogDe')}
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
          <p id={reasonId} className="mr-auto text-sm text-poke-text-muted">
            {blockedText}
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {text('save.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!gate.allowed}
          aria-describedby={blockedText !== null ? reasonId : undefined}
          onClick={onPublish}
        >
          {text('publish.confirm')}
        </Button>
      </div>
    </div>
  );
}

interface PublishDialogProps {
  text: ShellText;
  idPrefix: string;
  open: boolean;
  onClose: () => void;
  summary: ReactNode;
  gate: PublishGate;
  errorCount: number;
  dirty: boolean;
  publishedVersion: number | null;
  authorBase: Locale;
  readOnlyHref: string;
  /** The editor's save (publishing saves unsaved changes first) and its latest state (revision, save error). */
  save: () => Promise<SaveOutcome>;
  latest: () => EditorStateView;
  publish: PublishFlowArgs['publish'];
  classify: PublishFlowArgs['classify'];
  /** A version was published. */
  onPublished: (version: { versionNo: number; contentHash: string }) => void;
  /** A save or the publish found a newer revision on the server: the conflict dialog takes over. */
  onConflict: (staleRev?: number) => void;
}

/**
 * The publish dialog: shows what will be published, saves unsaved changes first, then publishes the saved
 * revision. A stale revision hands over to the conflict dialog; every other failure is shown inside the dialog.
 */
export default function PublishDialog({
  text,
  idPrefix,
  open,
  onClose,
  summary,
  gate,
  errorCount,
  dirty,
  publishedVersion,
  authorBase,
  readOnlyHref,
  save,
  latest,
  publish,
  classify,
  onPublished,
  onConflict,
}: PublishDialogProps) {
  const [changelog, setChangelog] = useState<Changelog>({ en: '', de: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [doneVersion, setDoneVersion] = useState<number | null>(null);
  const nextVersion = (publishedVersion ?? 0) + 1;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runPublishFlow({ dirty, changelog, authorBase, save, latest, publish, classify });
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
    <Modal open={open} onClose={close} size="lg" title={doneVersion === null ? text('publish.title', { n: nextVersion }) : text('publish.doneTitle')}>
      <PublishDialogBody
        text={text}
        idPrefix={idPrefix}
        summary={summary}
        gate={gate}
        errorCount={errorCount}
        dirty={dirty}
        nextVersion={nextVersion}
        publishedVersion={publishedVersion}
        changelog={changelog}
        onChangelog={setChangelog}
        busy={busy}
        error={error}
        doneVersion={doneVersion}
        readOnlyHref={readOnlyHref}
        onPublish={() => void run()}
        onClose={close}
      />
    </Modal>
  );
}
