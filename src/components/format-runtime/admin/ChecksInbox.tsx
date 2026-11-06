'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { useApiErrorText } from '@/i18n/use-api-error';
import { LocalTime } from '@/i18n/LocalTime';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { useValidationIssueText } from '@/components/teambuilder/LegalityBadge';
import { classifyFormatRuntimeError } from '@/lib/format-engine/runtime/client-api';
import { loadChecksRequest, resolveCheckRequest } from '@/lib/format-engine/runtime/client-api-admin';
import type { CheckVerdict, CheckView, ChecksPage } from '@/lib/format-engine/runtime/view-types';
import { speciesDisplayName } from '../player/entry-names';
import type { LText } from '@/lib/studio-core/ltext';
import type { ValidationIssueCode, ValidationIssueParams } from '@/types/team';
import { BUTTON_TOUCH, PAGE_SIZE, TEXT_MAX, codePointLength, labelText, nameOf, type PlayerNames } from './admin-shared';
import { describeCheck, matchIdOf, type CheckDescription } from './check-subject';
import { useAdminRequest } from './useAdminRequest';

/** The labels a sentence needs besides the player names: stage names and action names, from the format. */
export interface CheckLabels {
  stages: Readonly<Record<string, LText | null>>;
  actions: Readonly<Record<string, LText | null>>;
}

const KNOWN_SOURCES = [
  'unresolved_outcome',
  'standings_tie',
  'pairing_rematch',
  'pairing_forbidden',
  'deadline_missed',
  'team_audit',
  'expr',
] as const;
type KnownSource = (typeof KNOWN_SOURCES)[number];
const isKnownSource = (source: string): source is KnownSource => (KNOWN_SOURCES as readonly string[]).includes(source);

const KNOWN_REASONS = ['admin_review', 'undecidable_forfeit', 'no_valid_pick', 'pick_refused'] as const;
type KnownReason = (typeof KNOWN_REASONS)[number];
const isKnownReason = (reason: string): reason is KnownReason => (KNOWN_REASONS as readonly string[]).includes(reason);

interface BodyProps {
  check: CheckView;
  names: PlayerNames;
  labels: CheckLabels;
  /** The id of the element holding the sentence, so a form can be named after what it resolves. */
  sentenceId?: string;
}

/** The one sentence a check says, from its source and subject. An unknown source or subject gets the generic sentence. */
function CheckBody({ check, names, labels, sentenceId }: BodyProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const issueText = useValidationIssueText();
  const description: CheckDescription = describeCheck(check);

  const playerName = (id: string): string => nameOf(names, id) ?? t('formerPlayer');
  const players = (ids: readonly string[]): string => formatter.list(ids.map(playerName), 'conjunction');
  const stage = (key: string | null): string => (key === null ? t('checks.unknownStage') : labelText(labels.stages[key], locale, key));
  const round = (value: number | null): string | number => (value === null ? t('checks.unknownRound') : value);

  let sentence: ReactNode;
  switch (description.kind) {
    case 'unresolved_outcome':
      sentence = <p>{t('checks.sentence.unresolved_outcome', { players: players(description.players) })}</p>;
      break;
    case 'standings_tie':
      sentence = <p>{t('checks.sentence.standings_tie', { stage: stage(description.stage), players: players(description.players) })}</p>;
      break;
    case 'pairing_rematch':
      sentence = (
        <p>{t('checks.sentence.pairing_rematch', { count: description.count, round: round(description.round), stage: stage(description.stage) })}</p>
      );
      break;
    case 'pairing_forbidden':
      sentence = (
        <p>{t('checks.sentence.pairing_forbidden', { count: description.count, round: round(description.round), stage: stage(description.stage) })}</p>
      );
      break;
    case 'deadline_missed': {
      const reason = description.reason;
      sentence = (
        <>
          {description.action !== null && description.giverHidden === true ? (
            <p>
              {t('checks.sentence.deadline_action_hidden', {
                action: labelText(labels.actions[description.action], locale, description.action),
              })}
            </p>
          ) : description.action !== null ? (
            <p>
              {t('checks.sentence.deadline_action', {
                player: description.players.length > 0 ? players(description.players) : t('formerPlayer'),
                action: labelText(labels.actions[description.action], locale, description.action),
              })}
            </p>
          ) : (
            <p>
              {t('checks.sentence.deadline_match', {
                round: round(description.round),
                stage: stage(description.stage),
                players: players(description.players),
              })}
            </p>
          )}
          {reason !== null && (
            <p className="text-poke-text-muted">
              {isKnownReason(reason) ? t(`checks.reason.${reason}`) : t('checks.reason.unknown', { reason })}
            </p>
          )}
        </>
      );
      break;
    }
    case 'team_audit': {
      const player = description.player === null ? t('formerPlayer') : playerName(description.player);
      sentence = (
        <div className="space-y-2">
          {/* Only the headline names the form: the list of reasons below it is detail, not a name. */}
          <p id={sentenceId}>{t('checks.sentence.team_audit', { player, round: round(description.round) })}</p>
          <ul className="list-disc space-y-1 pl-5">
            {description.reasons.includes('rules') && description.teamHidden === true && <li>{t('checks.audit.rules_hidden')}</li>}
            {description.reasons.includes('rules') && description.teamHidden !== true && (
              <li>
                {t('checks.audit.rules')}
                <ul className="list-disc space-y-0.5 pl-5">
                  {description.issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      {issueText({ issue: issue.code, code: issue.code as ValidationIssueCode, params: issue.params as ValidationIssueParams })}
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {description.reasons.includes('observed_mismatch') && description.teamHidden === true && (
              <li>{t('checks.audit.observed_mismatch_hidden')}</li>
            )}
            {description.reasons.includes('observed_mismatch') && description.teamHidden !== true && (
              <li>
                {t('checks.audit.observed_mismatch', {
                  species: formatter.list(
                    description.offTeam.map((name) => speciesDisplayName(name, dataLocale)),
                    'conjunction',
                  ),
                })}
              </li>
            )}
            {description.reasons.includes('no_registered_team') && <li>{t('checks.audit.no_registered_team')}</li>}
            {description.reasons.includes('audit_unavailable') && (
              <li>
                {description.cause === null
                  ? t('checks.audit.audit_unavailable_unknown')
                  : t('checks.audit.audit_unavailable', { cause: t(`checks.audit.cause.${description.cause}`) })}
              </li>
            )}
            {description.editedAfterPlay && <li>{t('checks.audit.edited_after_play')}</li>}
          </ul>
          {description.teamHidden === true && <p className="text-poke-text-muted">{t('checks.audit.team_hidden')}</p>}
        </div>
      );
      break;
    }
    case 'generic':
      sentence = <p>{t('checks.sentence.generic')}</p>;
      break;
  }

  const matchId = matchIdOf(description);
  return (
    <div className="space-y-1 text-sm text-poke-text-primary">
      <div id={description.kind === 'team_audit' ? undefined : sentenceId}>{sentence}</div>
      {matchId !== null && (
        <Link
          href={`/admin/matches/${encodeURIComponent(matchId)}`}
          className={`inline-flex items-center font-medium text-poke-blue hover:underline ${BUTTON_TOUCH}`}
        >
          {t('checks.openMatch')}
        </Link>
      )}
    </div>
  );
}

function CheckHeader({ check, children }: { check: CheckView; children?: ReactNode }) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const rule = labelText(check.rule_label, locale, check.rule_id);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Badge variant={check.source === 'team_audit' ? 'purple' : 'blue'}>
        {isKnownSource(check.source) ? t(`checks.source.${check.source}`) : t('checks.source.unknown')}
      </Badge>
      <span className="text-xs text-poke-text-muted">{t('checks.rule', { rule })}</span>
      <span className="text-xs text-poke-text-muted">
        {t('checks.opened')} <LocalTime value={check.opened_at} preset="dateTimeYear" />
      </span>
      {children}
    </div>
  );
}

interface CardProps extends BodyProps {
  seasonId: string;
  onResolved: (check: CheckView, verdict: CheckVerdict) => void;
  /** A verdict the server found stale: reported by the inbox, which outlives the card the refreshed page takes away. */
  onStale: (error: ApiErrorLike) => void;
}

/** An open check: its sentence and the verdict form (Confirm or Reject, with an optional note). */
function CheckCard({ seasonId, check, names, labels, onResolved, onStale }: CardProps) {
  const t = useT(formatRuntimeAdminMessages);
  const { pending, errorMessage, run, refresh } = useAdminRequest();
  const [verdict, setVerdict] = useState<CheckVerdict | null>(null);
  const [note, setNote] = useState('');
  // The failure was handed to the inbox (a stale view): the card must not show it a second time.
  const [stale, setStale] = useState(false);
  const groupId = useId();
  const sentenceId = useId();
  const noteCounterId = useId();
  const length = codePointLength(note.trim());
  const tooLong = length > TEXT_MAX;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (verdict === null || tooLong || pending) return;
    setStale(false);
    const out = await run(() => resolveCheckRequest(seasonId, check.id, verdict, note));
    if (!out.ok) {
      // A conflict refreshes the server page, which no longer lists this check: the card unmounts with its own alert.
      if (classifyFormatRuntimeError(out.error, out.status).kind === 'conflict') {
        setStale(true);
        onStale(out.error);
      }
      return;
    }
    onResolved(check, verdict);
    refresh();
  }

  return (
    <li className="space-y-3 rounded-poke-md border border-poke-border bg-poke-surface p-4" data-check-id={check.id}>
      <CheckHeader check={check} />
      <CheckBody check={check} names={names} labels={labels} sentenceId={sentenceId} />
      {/* Every card repeats the same controls: the form is named after the sentence of its check, so a screen reader
          user in forms navigation can tell which check a verdict resolves. */}
      <form onSubmit={submit} className="space-y-3" aria-busy={pending} aria-labelledby={sentenceId}>
        <fieldset className="space-y-1" disabled={pending}>
          <legend id={groupId} className="text-sm font-heading font-semibold text-poke-text-primary">
            {t('checks.verdict.legend')}
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-labelledby={groupId}>
            {(['confirmed', 'rejected'] as const).map((value) => (
              <label key={value} className={`inline-flex items-center gap-2 text-sm text-poke-text-primary ${BUTTON_TOUCH}`}>
                <input
                  type="radio"
                  name={`verdict-${check.id}`}
                  value={value}
                  checked={verdict === value}
                  onChange={() => setVerdict(value)}
                  className="h-4 w-4 accent-poke-accent"
                />
                {t(`checks.verdict.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Textarea
          label={t('checks.note.label')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={noteCounterId}
          disabled={pending}
          rows={2}
        />
        <p id={noteCounterId} className={`text-xs ${tooLong ? 'text-poke-danger' : 'text-poke-text-muted'}`}>
          {t('adjust.reason.counter', { used: length, max: TEXT_MAX })}
        </p>
        {errorMessage !== null && !stale && <Alert variant="error">{errorMessage}</Alert>}
        <Button type="submit" size="sm" className={BUTTON_TOUCH} loading={pending} disabled={verdict === null || tooLong} aria-describedby={sentenceId}>
          {t('checks.resolve')}
        </Button>
      </form>
    </li>
  );
}

/**
 * The note the runtime stores when a match reset or reopen closes a team review check by itself (no admin, so
 * `resolved_by` is null). It is a code, not text: shown as a translated sentence.
 */
const SYSTEM_RESET_NOTE = 'match_reset';

function ResolvedRow({ check, names, labels }: BodyProps) {
  const t = useT(formatRuntimeAdminMessages);
  return (
    <li className="space-y-2 rounded-poke-md border border-poke-border px-4 py-3" data-check-id={check.id}>
      <CheckHeader check={check}>
        <Badge variant={check.state === 'confirmed' ? 'green' : 'gray'}>{t(`checks.state.${check.state}`)}</Badge>
      </CheckHeader>
      <CheckBody check={check} names={names} labels={labels} />
      <p className="text-xs text-poke-text-muted">
        {check.resolved_by !== null && <>{t('checks.resolvedBy', { name: check.resolved_by.name ?? t('formerPlayer') })} </>}
        {check.resolved_at !== null && <LocalTime value={check.resolved_at} preset="dateTimeYear" />}
        {check.resolved_by === null && check.note === SYSTEM_RESET_NOTE ? (
          <> · {t('checks.note.matchReset')}</>
        ) : (
          check.note !== null && check.note !== '' && <> · {t('checks.note.shown', { note: check.note })}</>
        )}
      </p>
    </li>
  );
}

interface HistoryState {
  open: boolean;
  loaded: boolean;
  /** Rows read so far, open ones included (the next page starts after them). */
  fetched: number;
  rows: CheckView[];
  total: number;
}

const HISTORY_CLOSED: HistoryState = { open: false, loaded: false, fetched: 0, rows: [], total: 0 };

/**
 * Pages one "Show resolved" / "Load more" click may read to find a resolved check. The list is read as `all` (open and
 * resolved, newest first), so a page can hold open checks only; reading on until a resolved one turns up keeps an empty
 * page from standing next to a "Load more" button, and the bound keeps one click from reading a very long open backlog.
 */
const MAX_HISTORY_PAGES = 5;

export interface ChecksInboxProps {
  seasonId: string;
  /** The first page of OPEN checks, read by the server page. */
  initial: ChecksPage;
  names: PlayerNames;
  labels: CheckLabels;
}

/**
 * The checks inbox of the Live tab: the open checks, each with a sentence built from its source and subject and a form to
 * record the admin's verdict, and, on demand, the resolved ones. The server page is the only source of the open list (its
 * first page; "Show more open checks" reads the following ones); after a verdict the page is read again, which also drops
 * the extra pages. A verdict is a record only: it changes no result.
 */
export default function ChecksInbox({ seasonId, initial, names, labels }: ChecksInboxProps) {
  const t = useT(formatRuntimeAdminMessages);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<{ verdict: CheckVerdict } | null>(null);
  const [history, setHistory] = useState<HistoryState>(HISTORY_CLOSED);
  const errorText = useApiErrorText(errorsSeasons, errorsAdmin, errorsCommon);
  // A verdict the server refused as stale (the check was resolved elsewhere): kept here, because the refreshed page
  // drops that check's card, and with it any message the card held.
  const [staleError, setStaleError] = useState<ApiErrorLike | null>(null);
  const historyRequest = useAdminRequest();
  const moreOpenRequest = useAdminRequest();
  // Open checks read after the first page, the total as of the latest read, and how many hidden checks that total
  // already leaves out (those hidden before it was read).
  const [extra, setExtra] = useState<readonly CheckView[]>([]);
  const [openTotal, setOpenTotal] = useState(initial.total);
  const [hiddenBase, setHiddenBase] = useState(0);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusStatus = useRef(false);

  // A new server page is the truth again: a check resolved here is gone from it, and the extra pages were read against
  // the old list. (Adjusting state while rendering, as React allows for state derived from a prop.)
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setExtra([]);
    setOpenTotal(initial.total);
    setHiddenBase(0);
    setHidden(new Set());
  }

  const known = new Map<string, CheckView>();
  for (const check of [...initial.checks, ...extra]) if (check.state === 'open' && !known.has(check.id)) known.set(check.id, check);
  const open = [...known.values()].filter((check) => !hidden.has(check.id));
  // `openTotal` counts every open check; a check hidden after its verdict is still counted until a read leaves it out.
  const openCount = Math.max(openTotal - (hidden.size - hiddenBase), open.length);

  // The card with the focused Resolve button is gone after a verdict: put focus on the status line, just above the list,
  // so the next Tab lands on the next card instead of the top of the page.
  useEffect(() => {
    if (!focusStatus.current) return;
    focusStatus.current = false;
    statusRef.current?.focus();
  }, [hidden]);

  function resolved(check: CheckView, verdict: CheckVerdict) {
    focusStatus.current = true;
    setStaleError(null);
    setHidden((prev) => new Set(prev).add(check.id));
    setStatus({ verdict });
    // The new verdict belongs in the resolved list: forget what was loaded, it is read again on demand.
    setHistory(HISTORY_CLOSED);
  }

  /** The next page of open checks, after the ones listed (a check that appeared meanwhile can only repeat one: deduplicated). */
  async function loadMoreOpen() {
    const out = await moreOpenRequest.run(() => loadChecksRequest(seasonId, 'open', { limit: PAGE_SIZE, offset: open.length }));
    if (!out.ok) return;
    setExtra((prev) => [...prev, ...out.data.checks]);
    setOpenTotal(out.data.total);
    setHiddenBase(hidden.size);
  }

  async function loadHistory(offset: number) {
    // The list is `all` (open and resolved mixed): read on while a page holds no resolved check yet.
    const rows: CheckView[] = [];
    let cursor = offset;
    let total = 0;
    for (let pages = 0; pages < MAX_HISTORY_PAGES; pages += 1) {
      const out = await historyRequest.run(() => loadChecksRequest(seasonId, 'all', { limit: PAGE_SIZE, offset: cursor }));
      if (!out.ok) return;
      cursor += out.data.checks.length;
      total = out.data.total;
      rows.push(...out.data.checks.filter((check) => check.state !== 'open'));
      if (rows.length > 0 || out.data.checks.length === 0 || cursor >= total) break;
    }
    // New checks sort to the top of the list, so an offset page can repeat the previous page's last rows: keep each once.
    setHistory((prev) => {
      const kept = offset === 0 ? [] : prev.rows;
      const shown = new Set(kept.map((row) => row.id));
      return { open: true, loaded: true, fetched: cursor, rows: [...kept, ...rows.filter((row) => !shown.has(row.id) && shown.add(row.id))], total };
    });
  }

  function toggleHistory() {
    if (history.open) {
      setHistory((prev) => ({ ...prev, open: false }));
      return;
    }
    if (history.loaded) setHistory((prev) => ({ ...prev, open: true }));
    else void loadHistory(0);
  }

  return (
    <div className="space-y-4" data-live-checks>
      <p className="text-sm text-poke-text-secondary">{t('checks.intro')}</p>
      <p className="text-sm font-heading font-semibold text-poke-text-primary">{t('checks.openCount', { count: openCount })}</p>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-poke-green">
        {status !== null ? t(`checks.done.${status.verdict}`) : ''}
      </div>
      {staleError !== null && <Alert variant="error">{errorText(staleError)}</Alert>}

      {open.length === 0 ? (
        <p className="rounded-poke-md border border-dashed border-poke-border px-3 py-4 text-sm text-poke-text-muted">{t('checks.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {open.map((check) => (
            <CheckCard key={check.id} seasonId={seasonId} check={check} names={names} labels={labels} onResolved={resolved} onStale={setStaleError} />
          ))}
        </ul>
      )}
      {open.length > 0 && open.length < openCount && (
        <div className="space-y-2">
          <p className="text-sm text-poke-text-muted">{t('checks.openShown', { shown: open.length, total: openCount })}</p>
          <Button variant="secondary" size="sm" className={BUTTON_TOUCH} loading={moreOpenRequest.pending} onClick={() => void loadMoreOpen()}>
            {t('checks.moreOpen')}
          </Button>
          {moreOpenRequest.errorMessage !== null && <Alert variant="error">{moreOpenRequest.errorMessage}</Alert>}
        </div>
      )}

      <div className="space-y-3 border-t border-poke-border pt-3">
        <Button variant="secondary" size="sm" className={BUTTON_TOUCH} aria-expanded={history.open} loading={historyRequest.pending && !history.loaded} onClick={toggleHistory}>
          {history.open ? t('checks.history.hide') : t('checks.history.show')}
        </Button>
        {historyRequest.errorMessage !== null && <Alert variant="error">{historyRequest.errorMessage}</Alert>}
        {history.open && (
          <div className="space-y-3">
            {history.rows.length === 0 ? (
              <p className="text-sm text-poke-text-muted">
                {history.fetched < history.total ? t('checks.history.noneYet') : t('checks.history.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {history.rows.map((check) => (
                  <ResolvedRow key={check.id} check={check} names={names} labels={labels} />
                ))}
              </ul>
            )}
            {history.fetched < history.total && (
              <Button variant="ghost" size="sm" className={BUTTON_TOUCH} loading={historyRequest.pending} onClick={() => void loadHistory(history.fetched)}>
                {t('checks.history.more')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
