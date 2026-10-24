'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Select from '@/components/ui/Select';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { resolveLText, type Locale } from '@/lib/format-kit/client';
import { previewAttach, type AttachPreview } from '@/lib/format-studio/editor/attach-preview';
import {
  attachFormatRequest,
  classifyApiError,
  detachFormatRequest,
  loadFormatDetail,
  type SeasonFormatAttachResponse,
} from '@/lib/format-studio/editor/api';
import type { EngineGap } from '@/lib/format-studio/library-types';
import AttachPreviewList, { EngineGapList } from './AttachPreviewList';
import {
  REFRESH_AFTER_CODES,
  attachButtonState,
  groupCandidates,
  type AttachBlockReason,
  type AttachCandidateView,
  type AttachedFormatView,
} from './attach-state';

/** The anchor of the panel: the readiness checklist links here (`?tab=format#format-attach`). */
export const FORMAT_ATTACH_ANCHOR = 'format-attach';

const HASH_PREFIX_CHARS = 12;

const BUTTON_TOUCH = 'min-h-11 sm:min-h-0';

// ─── Pieces (exported so the markup can be tested with state passed as props) ─────────────────────────────────────

/** Shown instead of every control once the league has started. */
export function StartedNotice() {
  const t = useT(formatStudioAttachMessages);
  return (
    <p role="note" className="rounded-poke-md border border-poke-border bg-poke-elevated px-3 py-2 text-sm text-poke-text-secondary">
      {t('panel.startedNotice')}
    </p>
  );
}

/** Hand-made phases block an attach; the API refuses it too. */
export function ManualPhasesNotice({ count, phasesHref }: { count: number; phasesHref: string }) {
  const t = useT(formatStudioAttachMessages);
  return (
    <div
      role="note"
      className="space-y-1 rounded-poke-md border border-poke-yellow/40 bg-poke-yellow-light px-3 py-2 text-sm text-poke-yellow-ink"
    >
      <p>{t('blocked.manualNotice', { count })}</p>
      <Link href={phasesHref} className={`inline-flex items-center font-medium underline ${BUTTON_TOUCH}`}>
        {t('panel.openPhases')}
      </Link>
    </div>
  );
}

/** The frozen hash, short, with the full value in `title` and a Copy button that falls back to selecting it. */
function HashCopy({ hash }: { hash: string }) {
  const t = useT(formatStudioAttachMessages);
  const codeRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setStatus('copied');
    } catch {
      // No clipboard permission: select the text so the keyboard copy works.
      try {
        const node = codeRef.current;
        if (node) window.getSelection()?.selectAllChildren(node);
      } catch {
        /* selection is a convenience only */
      }
      setStatus('failed');
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code ref={codeRef} title={hash} className="rounded-poke-sm bg-poke-muted px-1.5 py-0.5 text-xs">
        {hash.slice(0, HASH_PREFIX_CHARS)}
      </code>
      <button
        type="button"
        onClick={copy}
        className={`inline-flex items-center text-sm font-medium text-poke-blue hover:underline ${BUTTON_TOUCH}`}
      >
        {t('panel.copyHash')}
      </button>
      <span role="status" className="text-xs text-poke-text-muted">
        {status === 'copied' ? t('panel.copied') : status === 'failed' ? t('panel.copyFailed') : ''}
      </span>
    </span>
  );
}

interface AttachedSummaryProps {
  attached: AttachedFormatView;
  phasesHref: string;
  /** A started league keeps the summary and loses the buttons. */
  started: boolean;
  busy?: boolean;
  onReattach?: () => void;
  onDetach?: () => void;
}

/** The attached format: name, version, frozen hash and time, phases created, links, and Re-attach / Detach. */
export function AttachedSummary({ attached, phasesHref, started, busy = false, onReattach, onDetach }: AttachedSummaryProps) {
  const t = useT(formatStudioAttachMessages);
  const locale = useLocale();
  const formatter = useFormatter();
  const name = resolveLText(attached.name, { viewer: locale })?.value ?? '';
  return (
    <div className="space-y-3" data-attached-summary>
      <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('panel.attachedHeading')}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-heading text-poke-text-muted">{t('panel.attachedName')}</dt>
          <dd className="break-words text-poke-text-primary">
            {name}
            {' · '}
            {t('panel.version', { n: attached.version_no })}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-heading text-poke-text-muted">{t('panel.hash')}</dt>
          <dd className="text-poke-text-primary">
            <HashCopy hash={attached.spec_hash} />
          </dd>
        </div>
      </dl>
      <p className="text-sm text-poke-text-secondary">
        {t('panel.frozenAt', { date: formatter.instant(attached.frozen_at, 'dateTimeYear') })}
      </p>
      <p className="text-sm text-poke-text-secondary">
        {t('panel.phases', { count: attached.createdPhases })}{' '}
        <Link href={phasesHref} className="font-medium text-poke-blue hover:underline">
          {t('panel.openPhases')}
        </Link>
      </p>
      <p className="text-sm">
        {attached.definition_id !== null ? (
          <Link
            href={`/admin/formats/${encodeURIComponent(attached.definition_id)}`}
            className={`inline-flex items-center font-medium text-poke-blue hover:underline ${BUTTON_TOUCH}`}
          >
            {t('panel.openSource')}
          </Link>
        ) : (
          <span className="text-poke-text-muted">{t('panel.sourceDeleted')}</span>
        )}
      </p>
      {!started && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className={BUTTON_TOUCH} onClick={onReattach} disabled={busy}>
            {t('panel.reattach')}
          </Button>
          <Button variant="danger" size="sm" className={BUTTON_TOUCH} onClick={onDetach} disabled={busy}>
            {t('panel.detach')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface AttachBlockedReasonProps {
  id?: string;
  reason: AttachBlockReason;
  /** Stages that need the league's default ruleset (only the `ruleset_missing` sentence uses it). */
  rulesetCount?: number;
}

/** Why the Attach button is disabled, in one visible sentence. */
export function AttachBlockedReason({ id, reason, rulesetCount = 0 }: AttachBlockedReasonProps) {
  const t = useT(formatStudioAttachMessages);
  const text = (() => {
    switch (reason) {
      case 'started':
        return t('blocked.reasonStarted');
      case 'busy':
        return t('blocked.reasonBusy');
      case 'nothing_selected':
        return t('blocked.reasonNothing');
      case 'loading':
        return t('blocked.reasonLoading');
      case 'invalid':
        return t('blocked.reasonInvalid');
      case 'ruleset_missing':
        return t('blocked.reasonRuleset', { count: rulesetCount });
      case 'manual_phases':
        return t('blocked.reasonManual');
    }
  })();
  return (
    <p id={id} className="text-sm text-poke-text-muted" data-attach-reason={reason}>
      {text}
    </p>
  );
}

interface PickerProps {
  candidates: readonly AttachCandidateView[];
  capped: boolean;
  /** The chosen definition id, or '' for nothing. */
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/** The select of published formats, grouped by where they come from; an empty list gets an empty state. */
export function Picker({ candidates, capped, selectedId, onSelect, disabled = false }: PickerProps) {
  const t = useT(formatStudioAttachMessages);
  const locale = useLocale();
  const selectId = useId();

  if (candidates.length === 0) {
    return (
      <div className="space-y-1 rounded-poke-md border border-dashed border-poke-border px-3 py-4 text-sm" data-attach-empty>
        <p className="font-medium text-poke-text-primary">{t('panel.emptyTitle')}</p>
        <p className="text-poke-text-secondary">{t('panel.emptyBody')}</p>
        <Link href="/admin/formats" className={`inline-flex items-center font-medium text-poke-blue hover:underline ${BUTTON_TOUCH}`}>
          {t('panel.openStudio')}
        </Link>
      </div>
    );
  }

  function optionLabel(candidate: AttachCandidateView): string {
    const name = resolveLText(candidate.name, { viewer: locale })?.value ?? candidate.slug;
    const owner = candidate.mine
      ? t('panel.ownerYou')
      : candidate.visibility === 'gallery'
        ? t('panel.ownerGallery')
        : (candidate.ownerName ?? t('panel.ownerOther'));
    return t('panel.optionLabel', { name, version: candidate.version_no, owner });
  }

  return (
    <div className="space-y-2">
      <Select
        id={selectId}
        label={t('panel.pickerLabel')}
        value={selectedId}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{t('panel.pickerPlaceholder')}</option>
        {groupCandidates(candidates).map(({ group, items }) => (
          <optgroup key={group} label={t(`panel.group.${group}`)}>
            {items.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {optionLabel(candidate)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {capped && <p className="text-xs text-poke-text-muted">{t('panel.capNote', { count: candidates.length })}</p>}
    </div>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormatAttachPanelProps {
  seasonId: string;
  started: boolean;
  /** The league's ruleset; null when it has none. */
  rulesetId: string | null;
  /** The league's content language: phase names are resolved in it. */
  seasonLanguage: Locale;
  manualPhaseCount: number;
  attached: AttachedFormatView | null;
  candidates: readonly AttachCandidateView[];
  /** The list was cut at its cap. */
  capped: boolean;
  /** Link to the league's Phases tab. */
  phasesHref: string;
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'failed'; id: string; error: ApiErrorLike }
  | { status: 'ready'; id: string; versionNo: number; preview: AttachPreview };

type Outcome =
  | {
      kind: 'attached';
      stages: SeasonFormatAttachResponse['stages'];
      warnings: EngineGap[];
      names: Record<string, string>;
    }
  | { kind: 'detached'; count: number };

/**
 * The attach panel of a custom league's Format tab. States: started (locked), attached (summary with Re-attach and
 * Detach), unattached or re-attaching (picker, preview of the phases an attach would create, Attach). The chosen
 * version is previewed with the browser compile before anything is written; the buttons say in words why they are
 * disabled. After a write the page is read again, so the readiness card and the outline follow the server.
 */
export default function FormatAttachPanel({
  seasonId,
  started,
  rulesetId,
  seasonLanguage,
  manualPhaseCount,
  attached,
  candidates,
  capped,
  phasesHref,
}: FormatAttachPanelProps) {
  const t = useT(formatStudioAttachMessages);
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsSeasons, errorsCommon);
  const reasonId = useId();

  const [reattaching, setReattaching] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ error: ApiErrorLike; blocked: boolean } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirm, setConfirm] = useState<'reattach' | 'detach' | null>(null);
  // Only the newest preview request may write its answer.
  const ticket = useRef(0);
  useEffect(
    () => () => {
      ticket.current += 1;
    },
    [],
  );

  const loadPreview = useCallback(
    async (id: string) => {
      const mine = ++ticket.current;
      setPreview({ status: 'loading', id });
      const out = await loadFormatDetail(id);
      if (mine !== ticket.current) return;
      if (!out.ok) {
        setPreview({ status: 'failed', id, error: out.error });
        return;
      }
      const published = out.data.published;
      if (published === null) {
        setPreview({ status: 'failed', id, error: { code: 'format_not_published' } });
        return;
      }
      try {
        const result = previewAttach({
          spec: published.spec,
          seasonRulesetId: rulesetId,
          seasonLanguage,
          specHash: published.content_hash,
        });
        setPreview({ status: 'ready', id, versionNo: published.version_no, preview: result });
      } catch {
        setPreview({ status: 'failed', id, error: { code: 'unknown_error' } });
      }
    },
    [rulesetId, seasonLanguage],
  );

  function select(id: string) {
    setError(null);
    setOutcome(null);
    setSelectedId(id);
    if (id === '') {
      ticket.current += 1;
      setPreview({ status: 'idle' });
      return;
    }
    void loadPreview(id);
  }

  function reportFailure(failure: ApiErrorLike, status: number) {
    const kind = classifyApiError(failure, status).kind;
    setError({ error: failure, blocked: kind === 'blocked' });
    if (failure.code && REFRESH_AFTER_CODES.has(failure.code)) router.refresh();
  }

  async function runAttach() {
    if (preview.status !== 'ready' || !preview.preview.ok) return;
    const names: Record<string, string> = {};
    for (const stage of preview.preview.stages) names[stage.key] = stage.name;
    setConfirm(null);
    setBusy(true);
    setError(null);
    setOutcome(null);
    const out = await attachFormatRequest(seasonId, preview.id, preview.versionNo);
    setBusy(false);
    if (!out.ok) {
      reportFailure(out.error, out.status);
      return;
    }
    setOutcome({ kind: 'attached', stages: out.data.stages, warnings: out.data.warnings, names });
    setReattaching(false);
    setSelectedId('');
    setPreview({ status: 'idle' });
    router.refresh();
  }

  async function runDetach() {
    setConfirm(null);
    setBusy(true);
    setError(null);
    setOutcome(null);
    const out = await detachFormatRequest(seasonId);
    setBusy(false);
    if (!out.ok) {
      reportFailure(out.error, out.status);
      return;
    }
    setOutcome({ kind: 'detached', count: out.data.removed_stage_ids.length });
    setReattaching(false);
    router.refresh();
  }

  const previewResult = preview.status === 'ready' ? preview.preview : null;
  const button = attachButtonState({
    started,
    selected: selectedId !== '',
    preview: previewResult,
    manualPhaseCount,
    busy,
  });
  const showPicker = !started && (attached === null || reattaching);

  const submitLabel = busy ? t('panel.attachBusy') : attached === null ? t('panel.attach') : t('panel.reattachSubmit');

  return (
    <div id={FORMAT_ATTACH_ANCHOR} className="space-y-4" aria-busy={busy} data-format-attach-panel>
      <p className="text-sm text-poke-text-secondary">{t('panel.intro')}</p>

      {started && <StartedNotice />}

      {attached !== null && (
        <AttachedSummary
          attached={attached}
          phasesHref={phasesHref}
          started={started}
          busy={busy}
          onReattach={() => setReattaching(true)}
          onDetach={() => setConfirm('detach')}
        />
      )}

      {!started && manualPhaseCount > 0 && <ManualPhasesNotice count={manualPhaseCount} phasesHref={phasesHref} />}

      {showPicker && (
        <div className="space-y-3">
          <Picker candidates={candidates} capped={capped} selectedId={selectedId} onSelect={select} disabled={busy} />

          <div aria-live="polite" aria-busy={preview.status === 'loading'} className="space-y-2">
            {preview.status === 'loading' && <p className="text-sm text-poke-text-muted">{t('panel.loadingPreview')}</p>}
            {preview.status === 'failed' && (
              <Alert variant="error" className="space-y-2">
                <p>
                  {t('panel.previewFailed')} {errorText(preview.error)}
                </p>
                <Button variant="secondary" size="sm" className={BUTTON_TOUCH} onClick={() => void loadPreview(preview.id)}>
                  {t('panel.retry')}
                </Button>
              </Alert>
            )}
            {previewResult !== null && (
              <AttachPreviewList preview={previewResult} formatHref={`/admin/formats/${encodeURIComponent(selectedId)}`} />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              className={BUTTON_TOUCH}
              disabled={!button.enabled}
              loading={busy}
              aria-describedby={button.reason !== null && button.reason !== 'busy' ? reasonId : undefined}
              onClick={() => (attached === null ? void runAttach() : setConfirm('reattach'))}
            >
              {submitLabel}
            </Button>
            {attached !== null && (
              <Button variant="ghost" className={BUTTON_TOUCH} disabled={busy} onClick={() => setReattaching(false)}>
                {t('panel.cancelReattach')}
              </Button>
            )}
          </div>
          {button.reason !== null && button.reason !== 'busy' && (
            <AttachBlockedReason
              id={reasonId}
              reason={button.reason}
              rulesetCount={previewResult && previewResult.ok ? previewResult.leagueRulesetMissing : 0}
            />
          )}
        </div>
      )}

      <div role="status" aria-live="polite" className="space-y-2">
        {outcome?.kind === 'attached' && (
          <div className="space-y-2 text-sm" data-attach-result>
            <p className="font-medium text-poke-green">{t('panel.done', { count: outcome.stages.length })}</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-poke-text-secondary">
              {[...outcome.stages]
                .sort((a, b) => a.stage_order - b.stage_order)
                .map((stage) => (
                  <li key={stage.id} className="break-words">
                    {outcome.names[stage.key] ?? stage.key}
                  </li>
                ))}
            </ol>
            <EngineGapList gaps={outcome.warnings} stageNames={outcome.names} />
          </div>
        )}
        {outcome?.kind === 'detached' && (
          <p className="text-sm font-medium text-poke-green">{t('panel.detached', { count: outcome.count })}</p>
        )}
      </div>

      {error !== null && <Alert variant={error.blocked ? 'warning' : 'error'}>{errorText(error.error)}</Alert>}

      <ConfirmDialog
        open={confirm === 'reattach'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runAttach()}
        title={t('panel.reattachTitle')}
        message={t('panel.reattachBody')}
        confirmLabel={t('panel.reattachConfirm')}
        confirmVariant="primary"
        loading={busy}
      />
      <ConfirmDialog
        open={confirm === 'detach'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runDetach()}
        title={t('panel.detachTitle')}
        message={t('panel.detachBody', { count: attached?.createdPhases ?? 0 })}
        confirmLabel={t('panel.detachConfirm')}
        loading={busy}
      />
    </div>
  );
}
