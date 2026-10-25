'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ADMIN_MATCH_NOTE_MAX_LENGTH,
  BULK_CONFIRM_EXPECTED_STATUS,
  adminMatchBatchSchema,
  localInputToIsoInZone,
  summarizeBulkResults,
  type AdminMatchBatchInput,
  type AdminMatchBatchResponse,
  type AdminMatchBulkAction,
  type BulkItemResult,
} from '@/lib/admin/match-bulk';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import { postMatchBatch } from '@/components/admin/match-bulk-client';
import { bulkConfirmPreview, bulkResultRows, bulkScheduleSplit } from '@/components/admin/match-list-view';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { shellMessages } from '@/i18n/messages/shell';
import { errorsAdmin, errorsMatches } from '@/i18n/messages/errors';

/** The bounds `datetime-local` offers; the same years the API accepts. */
const SCHEDULE_INPUT_MIN = '2000-01-01T00:00';
const SCHEDULE_INPUT_MAX = '2100-12-31T23:59';

type DialogRow = AdminMatchRow;

/**
 * The request a dialog sends for the current input, or `null` while the input is not valid (no time chosen or one
 * outside the accepted years, an empty note). It is the API's own schema that decides, so the submit button and the
 * route can never disagree. Time and note go out for every selected match; the server re-checks each one on fresh
 * data and reports the ones that do not qualify. A confirm goes out only for the matches the dialog previewed as
 * confirmable, each with the reported winner the admin saw, so the server finalizes that winner or reports a conflict.
 */
export function buildBatchBody(
  kind: AdminMatchBulkAction,
  rows: readonly DialogRow[],
  input: { scheduleValue: string; note: string; timeZone: string },
): AdminMatchBatchInput | null {
  const match_ids = rows.map((row) => row.id);
  let candidate: unknown;
  if (kind === 'confirm') {
    const items = bulkConfirmPreview(rows).items;
    candidate = {
      action: 'confirm',
      match_ids: items.map((item) => item.id),
      params: {
        expected: items.map((item) => ({
          match_id: item.id,
          winner_id: item.winnerId,
          status: BULK_CONFIRM_EXPECTED_STATUS,
        })),
      },
    };
  } else {
    candidate =
      kind === 'schedule'
        ? { action: 'schedule', match_ids, params: { scheduled_at: localInputToIsoInZone(input.scheduleValue, input.timeZone) } }
        : { action: 'note', match_ids, params: { note: input.note } };
  }
  const parsed = adminMatchBatchSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type BulkDialogPhase = 'input' | 'submitting' | 'done';

interface BodyProps {
  kind: AdminMatchBulkAction;
  rows: readonly DialogRow[];
  timeZone: string;
  scheduleValue: string;
  onScheduleChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  phase: BulkDialogPhase;
  /** A whole-request failure (403, 429, 400, network); the input stays. */
  error: ApiErrorLike | null;
  response: AdminMatchBatchResponse | null;
  onSubmit: () => void;
  onClose: () => void;
}

/** The content of a bulk dialog (everything inside the modal frame); the stateful dialog below feeds it. */
export function AdminMatchBulkDialogBody(props: BodyProps) {
  const { kind, rows, phase, error, response, onClose } = props;
  const t = useT(shellMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsMatches);
  const summaryText = useBulkSummaryText();
  // Always mounted, so the outcome that is put into it when the response arrives is spoken. The list behind the
  // modal is hidden from assistive technology while it is open, and text that mounts together with its region is
  // often skipped.
  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {phase === 'done' && response ? summaryText(response.results) : ''}
    </div>
  );

  if (phase === 'done' && response) {
    return (
      <>
        {liveRegion}
        <BulkResultsPanel results={response.results} rows={rows} onClose={onClose} />
      </>
    );
  }

  const submitting = phase === 'submitting';
  const body = buildBatchBody(kind, rows, props);
  // How many of the selection the action applies to; a note applies to all of them.
  const eligible =
    kind === 'confirm'
      ? bulkConfirmPreview(rows).items.length
      : kind === 'schedule'
        ? bulkScheduleSplit(rows).eligibleIds.length
        : rows.length;
  const canSubmit = body !== null && eligible > 0 && !submitting;
  const submitLabel = submitting
    ? t('admin.matches.bulk.working')
    : t(`admin.matches.bulk.${kind}.submit`, { count: eligible });

  const form = (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (canSubmit) props.onSubmit();
      }}
    >
      {kind === 'confirm' && <BulkConfirmFields rows={rows} />}
      {kind === 'schedule' && (
        <BulkScheduleFields
          rows={rows}
          timeZone={props.timeZone}
          value={props.scheduleValue}
          onChange={props.onScheduleChange}
          invalid={props.scheduleValue !== '' && body === null}
          disabled={submitting}
        />
      )}
      {kind === 'note' && <BulkNoteFields value={props.note} onChange={props.onNoteChange} disabled={submitting} />}

      {error && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting} className="min-h-[44px]">
          {t('admin.matches.bulk.result.close')}
        </Button>
        <Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit} className="min-h-[44px]">
          {submitLabel}
        </Button>
      </div>
    </form>
  );

  return (
    <>
      {liveRegion}
      {form}
    </>
  );
}

/** Confirm: what will be confirmed (winner, score, best-of), what will be skipped and why, and the warning. */
function BulkConfirmFields({ rows }: { rows: readonly DialogRow[] }) {
  const t = useT(shellMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsMatches);
  const versus = (player1: string, player2: string) => t('admin.matches.versus', { player1, player2 });
  const preview = bulkConfirmPreview(rows, versus);

  return (
    <div className="space-y-3">
      <p className="text-sm text-poke-text-secondary">{t('admin.matches.bulk.confirm.intro')}</p>
      {preview.items.length === 0 ? (
        <Alert variant="warning">{t('admin.matches.bulk.confirm.nothingEligible')}</Alert>
      ) : (
        <section aria-label={t('admin.matches.bulk.confirm.willConfirm', { count: preview.items.length })}>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary">
            {t('admin.matches.bulk.confirm.willConfirm', { count: preview.items.length })}
          </h3>
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-sm">
            {preview.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-poke-text-primary">{item.label}</span>
                {item.score && (
                  <span className="text-xs font-heading font-semibold text-poke-text-secondary">
                    {t('admin.matches.row.score', { p1: item.score.p1, p2: item.score.p2 })}
                  </span>
                )}
                {item.bestOf > 0 && (
                  <span className="text-xs text-poke-text-muted">{t('admin.matches.row.bestOf', { count: item.bestOf })}</span>
                )}
                {item.winnerName && (
                  <span className="text-xs text-poke-green">{t('admin.matches.bulk.confirm.winner', { name: item.winnerName })}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview.skipped.length > 0 && (
        <section aria-label={t('admin.matches.bulk.confirm.skippedHeading', { count: preview.skipped.length })}>
          <h3 className="text-sm font-heading font-semibold text-poke-text-muted">
            {t('admin.matches.bulk.confirm.skippedHeading', { count: preview.skipped.length })}
          </h3>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-poke-text-muted">
            {preview.skipped.map((item) => (
              <li key={item.id}>
                {t('admin.matches.bulk.result.reasonLine', { match: item.label, reason: errorText({ code: item.code }) })}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview.items.length > 0 && <Alert variant="warning">{t('admin.matches.bulk.confirm.warning')}</Alert>}
    </div>
  );
}

/** Set time: a `datetime-local` field read in the viewer's zone, and how many of the selection it applies to. */
function BulkScheduleFields({
  rows,
  timeZone,
  value,
  onChange,
  invalid,
  disabled,
}: {
  rows: readonly DialogRow[];
  timeZone: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  disabled: boolean;
}) {
  const t = useT(shellMessages);
  const split = bulkScheduleSplit(rows);
  const completed = split.skipped.length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-poke-text-secondary">{t('admin.matches.bulk.schedule.intro')}</p>
      <Input
        id="bulk-schedule-at"
        type="datetime-local"
        label={t('admin.matches.bulk.schedule.field')}
        error={invalid ? t('admin.matches.bulk.schedule.invalid') : undefined}
        min={SCHEDULE_INPUT_MIN}
        max={SCHEDULE_INPUT_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <p className="text-xs text-poke-text-muted">{t('admin.matches.bulk.schedule.zoneHint', { zone: timeZone })}</p>
      <p className="text-sm text-poke-text-secondary">
        {t('admin.matches.bulk.schedule.applies', { eligible: split.eligibleIds.length, total: rows.length })}
        {completed > 0 && <> {t('admin.matches.bulk.schedule.skippedCompleted', { count: completed })}</>}
      </p>
    </div>
  );
}

/** Add note: the text and a live counter against the per-note limit. */
function BulkNoteFields({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useT(shellMessages);
  const f = useFormatter();
  // The API trims the note, so the counter counts what would be stored.
  const used = value.trim().length;
  const over = used > ADMIN_MATCH_NOTE_MAX_LENGTH;

  return (
    <div className="space-y-2">
      <p className="text-sm text-poke-text-secondary">{t('admin.matches.bulk.note.intro')}</p>
      <Textarea
        id="bulk-note"
        label={t('admin.matches.bulk.note.field')}
        placeholder={t('admin.matches.bulk.note.placeholder')}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <p className={`text-right text-xs ${over ? 'text-poke-danger' : 'text-poke-text-muted'}`}>
        {t('admin.matches.bulk.note.counter', { used: f.number(used), max: f.number(ADMIN_MATCH_NOTE_MAX_LENGTH) })}
      </p>
    </div>
  );
}

/** "3 of 5 done, 1 skipped, 1 failed": the one-line outcome of a batch, only the non-zero counts after the first. */
export function useBulkSummaryText(): (results: readonly Pick<BulkItemResult, 'ok' | 'code'>[]) => string {
  const t = useT(shellMessages);
  const f = useFormatter();
  return (results) => {
    const summary = summarizeBulkResults(results);
    const parts = [t('admin.matches.bulk.result.summary', { changed: summary.changed, total: summary.requested })];
    if (summary.skipped > 0) parts.push(t('admin.matches.bulk.result.skipped', { count: summary.skipped }));
    if (summary.conflicts > 0) parts.push(t('admin.matches.bulk.result.conflicts', { count: summary.conflicts }));
    if (summary.failed > 0) parts.push(t('admin.matches.bulk.result.failed', { count: summary.failed }));
    return f.list(parts, 'unit');
  };
}

/**
 * The report of a finished batch: a status line with the counts, then every item that was not a plain success as
 * "P1 vs P2: reason". Failures and conflicts are loud, a completed-with-warning match is amber, a skipped match is
 * muted (nothing went wrong, it just did not qualify).
 */
export function BulkResultsPanel({
  results,
  rows,
  onClose,
}: {
  results: readonly BulkItemResult[];
  rows: readonly DialogRow[];
  onClose?: () => void;
}) {
  const t = useT(shellMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsMatches);
  const versus = (player1: string, player2: string) => t('admin.matches.versus', { player1, player2 });

  const summaryText = useBulkSummaryText();

  const report = bulkResultRows(results, rows, versus);
  const failed = report.filter((item) => item.kind === 'failed' || item.kind === 'conflict');
  const warnings = report.filter((item) => item.kind === 'warning');
  const skipped = report.filter((item) => item.kind === 'skipped');
  const line = (item: (typeof report)[number]) =>
    t('admin.matches.bulk.result.reasonLine', { match: item.label, reason: errorText({ code: item.code, params: item.params }) });

  // The submit button that had focus is gone by now; moving focus to the report makes it the next thing read.
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => container.current?.focus(), []);

  return (
    <div ref={container} tabIndex={-1} className="space-y-4 focus:outline-none">
      <p className="text-sm font-heading font-semibold text-poke-text-primary">
        {summaryText(results)}
      </p>
      {failed.length > 0 && (
        <section>
          <h3 className="text-sm font-heading font-semibold text-poke-danger">{t('admin.matches.bulk.result.failedHeading')}</h3>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-sm text-poke-danger">
            {failed.map((item) => (
              <li key={item.id}>{line(item)}</li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section>
          <h3 className="text-sm font-heading font-semibold text-poke-yellow-ink">{t('admin.matches.bulk.result.warningHeading')}</h3>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-sm text-poke-yellow-ink">
            {warnings.map((item) => (
              <li key={item.id}>{line(item)}</li>
            ))}
          </ul>
        </section>
      )}
      {skipped.length > 0 && (
        <section>
          <h3 className="text-sm font-heading font-semibold text-poke-text-muted">{t('admin.matches.bulk.result.skippedHeading')}</h3>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-poke-text-muted">
            {skipped.map((item) => (
              <li key={item.id}>{line(item)}</li>
            ))}
          </ul>
        </section>
      )}
      {onClose && (
        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={onClose} className="min-h-[44px]">
            {t('admin.matches.bulk.result.close')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One bulk action on the selected rows: input, then the request, then the report. `rows` is the selection as it
 * was when the dialog opened (the list reloads behind the report), `onDone` hands the per-match results to the list
 * as soon as they arrive. The request is aborted when the dialog unmounts, and the dialog cannot be closed while
 * the request runs, so a started batch is never left without its report.
 */
export default function AdminMatchBulkDialog({
  kind,
  rows,
  timeZone,
  onClose,
  onDone,
}: {
  kind: AdminMatchBulkAction;
  rows: readonly DialogRow[];
  timeZone: string;
  onClose: () => void;
  onDone: (results: BulkItemResult[]) => void;
}) {
  const t = useT(shellMessages);
  const [scheduleValue, setScheduleValue] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<BulkDialogPhase>('input');
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [response, setResponse] = useState<AdminMatchBatchResponse | null>(null);
  // A second click or Enter before the first render with `submitting` is caught here.
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    const body = buildBatchBody(kind, rows, { scheduleValue, note, timeZone });
    if (!body) return;
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setPhase('submitting');
    const result = await postMatchBatch(body, abort.signal);
    inFlight.current = false;
    if (abort.signal.aborted) return;
    if (result.success) {
      setResponse(result.data);
      setPhase('done');
      onDone(result.data.results);
    } else {
      setError(toApiErrorLike(result));
      setPhase('input');
    }
  }, [kind, rows, scheduleValue, note, timeZone, onDone]);

  return (
    <Modal
      open
      onClose={phase === 'submitting' ? () => {} : onClose}
      title={t(`admin.matches.bulk.${kind}.title`)}
      size="lg"
    >
      <AdminMatchBulkDialogBody
        kind={kind}
        rows={rows}
        timeZone={timeZone}
        scheduleValue={scheduleValue}
        onScheduleChange={setScheduleValue}
        note={note}
        onNoteChange={setNote}
        phase={phase}
        error={error}
        response={response}
        onSubmit={() => void submit()}
        onClose={onClose}
      />
    </Modal>
  );
}
