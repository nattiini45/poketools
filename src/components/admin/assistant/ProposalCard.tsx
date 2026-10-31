'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import { PANEL, PANEL_INSET } from '@/components/ui/panel';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useFormatter, useT } from '@/i18n/client';
import { errorsAdminAssistant } from '@/i18n/messages/errors';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { adminAssistantCardsMessages } from '@/i18n/messages/admin-assistant-cards';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { CardLine, CardStep, CardTarget, ProposalCard as StoredCard } from '@/lib/ai/admin-agent/proposals/card';
import { approveProposal, declineProposal, getProposal, resumeProposal } from './api';
import type { CardView, ProposalDetail, ProposalResultView } from './types';

type StepView = CardView['steps'][number];

type CardParam = NonNullable<CardLine['params']>[string];
type StatusKey = 'notExecuted' | 'executing' | 'executed' | 'failed' | 'unknown' | 'stale' | 'declined' | 'expired' | 'superseded' | 'skipped' | 'partial' | 'undone';

/** Card status (the stored status, `expired` once past its time) to the catalog word. */
const CARD_STATUS: Record<CardView['effectiveStatus'], StatusKey> = {
  proposed: 'notExecuted',
  executing: 'executing',
  completed: 'executed',
  partial: 'partial',
  failed: 'failed',
  declined: 'declined',
  expired: 'expired',
  superseded: 'superseded',
  stale: 'stale',
  unknown: 'unknown',
};

const STEP_STATUS: Record<CardView['steps'][number]['status'], StatusKey> = {
  pending: 'notExecuted',
  executing: 'executing',
  ok: 'executed',
  failed: 'failed',
  unknown: 'unknown',
  skipped: 'skipped',
  undone: 'undone',
};

type BadgeVariant = 'default' | 'accent' | 'red' | 'blue' | 'green' | 'yellow' | 'gray';
const STATUS_VARIANT: Record<StatusKey, BadgeVariant> = {
  notExecuted: 'gray',
  executing: 'blue',
  executed: 'green',
  failed: 'red',
  unknown: 'yellow',
  stale: 'yellow',
  declined: 'gray',
  expired: 'gray',
  superseded: 'gray',
  skipped: 'gray',
  partial: 'yellow',
  undone: 'gray',
};

/** How often a card whose steps are running is re-read, so the step chips follow the run. */
const PROGRESS_POLL_MS = 3000;

/** The statuses that get a result headline: the proposal ran, or is running. */
const RESULT_STATUSES: ReadonlySet<CardView['effectiveStatus']> = new Set(['completed', 'partial', 'failed', 'stale', 'unknown', 'executing']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The app route for the entity a finished step made or acted on, only for an id the server served from the ledger. A league goes
 * to its admin page, a tournament to its public page, a ruleset (a publish or a pin move) to its editor page.
 */
export function entityLink(op: string, entityId: string | null): { key: 'league' | 'tournament' | 'ruleset'; href: string } | null {
  if (entityId === null || !UUID.test(entityId)) return null;
  const id = entityId.toLowerCase();
  switch (op) {
    case 'league_create':
      return { key: 'league', href: `/admin/leagues/${id}` };
    case 'tournament_create':
      return { key: 'tournament', href: `/tournaments/${id}` };
    case 'publish_ruleset':
    case 'move_pin':
      return { key: 'ruleset', href: `/admin/rulesets/${id}` };
    default:
      return null;
  }
}

/** The approve or resume answer laid over the card it came from, until the stored state is read again. */
function withResult(card: CardView, result: ProposalResultView): CardView {
  const byKey = new Map(result.steps.map((step) => [step.key, step]));
  return {
    ...card,
    status: result.status,
    effectiveStatus: result.status,
    actionable: false,
    secondsLeft: null,
    steps: card.steps.map((step) => {
      const summary = byKey.get(step.key);
      return summary === undefined ? step : { ...step, status: summary.status, errorCode: summary.code ?? null, entityId: summary.entity_id ?? step.entityId };
    }),
  };
}

const NFC = (value: string): string => value.normalize('NFC').trim();
const paramValue = (param: CardParam | undefined): string | number => {
  if (param === undefined) return '';
  if (typeof param === 'object') return param.text;
  return typeof param === 'boolean' ? String(param) : param;
};
const hiddenOf = (param: CardParam | undefined): number => (typeof param === 'object' && param !== null ? param.hidden : 0);

/** The catalog key and params that render one card line. The card holds kinds and values, never a sentence. */
export function lineMessage(line: CardLine): { key: string; params: Record<string, string | number> } {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(line.params ?? {})) params[name] = paramValue(value);
  const has = (name: string) => line.params?.[name] !== undefined;
  switch (line.kind) {
    case 'pins_ruleset_auto':
      return { key: has('ruleset') ? 'lines.pins_ruleset_auto' : 'lines.pins_ruleset_auto_unknown', params };
    case 'prefilled_from_standings':
      if (!has('count')) return { key: 'lines.prefilled_from_standings', params };
      return { key: line.params?.per_group === true ? 'lines.prefilled_top_per_group' : 'lines.prefilled_top', params };
    case 'clones_from':
      return { key: line.params?.copy_roster === true ? 'lines.clones_from_roster' : 'lines.clones_from', params };
    case 'pin_impact':
      return { key: line.params?.truncated === true ? 'lines.pin_impact_truncated' : 'lines.pin_impact', params };
    default:
      return { key: `lines.${line.kind}`, params };
  }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export interface ProposalCardProps {
  proposalId: string;
  /** The approve route executes (phase 1 and later). In phase 0 Confirm stays off and the card says why. */
  approveEnabled: boolean;
  /** Called after a decline or an approve, so the conversation re-reads the transcript and the proposal list. */
  onChanged?: () => void;
  /** Asks the assistant to stage the undo of this executed proposal (the conversation starts the turn). Absent: no Undo button. */
  onUndo?: (proposalId: string) => void;
}

/**
 * A proposal card (plan 4.5 "The card", 5.4): the frozen preview the server built from stored data, rendered in the
 * viewer's language with live status chips. Nothing the model wrote reaches it. Confirm stays disabled until every
 * acknowledgement is ticked (and the typed name matches), takes no default focus and never submits by itself.
 */
export default function ProposalCard({ proposalId, approveEnabled, onChanged, onUndo }: ProposalCardProps) {
  const t = useT(adminAssistantMessages);
  const cards = useT(adminAssistantCardsMessages);
  const formatter = useFormatter();
  const errorText = useApiErrorText(errorsAdminAssistant);
  const headingId = useId();

  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiErrorLike | null>(null);
  const [actionError, setActionError] = useState<ApiErrorLike | null>(null);
  const [busy, setBusy] = useState<'approve' | 'decline' | 'resume' | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const result = await getProposal(proposalId);
    if (result.ok) {
      setDetail(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = detail?.card ?? null;
  // While the steps run (this tab's approve or resume, or a Build left open inside its window) the stored ledger is re-read.
  const polling = busy === 'approve' || busy === 'resume' || (card?.effectiveStatus === 'executing' && card.resume?.eligible === true);
  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (typeof document === 'undefined' || !document.hidden) await load();
      if (!stopped) timer = setTimeout(() => void tick(), PROGRESS_POLL_MS);
    };
    timer = setTimeout(() => void tick(), PROGRESS_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [polling, load]);

  const actionable = card?.actionable === true;
  const now = useNow(actionable);
  const secondsLeft = card === null ? 0 : Math.max(0, Math.ceil((Date.parse(card.expiresAt) - now) / 1000));
  const live = actionable && secondsLeft > 0;

  const acks = useMemo(() => card?.card.acks ?? [], [card]);
  const acksSatisfied = useMemo(
    () =>
      acks.every((ack) => {
        if (ack.kind === 'checkbox') return ticked.has(ack.id);
        return ack.expected !== undefined && NFC(typed) === NFC(ack.expected.text);
      }),
    [acks, ticked, typed],
  );

  if (loadError !== null && card === null) {
    return (
      <section className={`${PANEL} p-3`} aria-label={t('errors.loadFailed')}>
        <Alert variant="error">{errorText(loadError)}</Alert>
        <Button className="mt-2" size="sm" variant="secondary" onClick={() => void load()}>
          {t('errors.retry')}
        </Button>
      </section>
    );
  }
  if (card === null || detail === null) {
    return (
      <section className={`${PANEL} p-3 text-sm text-poke-text-muted`} aria-busy="true">
        {t('states.loading')}
      </section>
    );
  }

  const status = CARD_STATUS[card.effectiveStatus];
  const expanded = open ?? (card.effectiveStatus === 'proposed' || card.effectiveStatus === 'executing');
  const stored: StoredCard = card.card;
  const resultStatus = RESULT_STATUSES.has(card.effectiveStatus) ? card.effectiveStatus : null;
  const stepStatus = new Map(card.steps.map((step) => [step.key, step]));
  const canApprove = live && approveEnabled && detail.token !== null && acksSatisfied && busy === null;

  const ackText = (ack: StoredCard['acks'][number]): string => {
    if (ack.kind === 'typed_name') return cards('ack.typedName', { name: ack.expected?.text ?? '' });
    if (ack.id === 'visible_publicly') return cards('ack.visiblePublicly');
    const effect = ack.effect ?? ack.id;
    return `${cards('ack.understand')} ${cards.dynamic(`effects.keys.${effect}`, undefined, cards('effects.generic'))}`;
  };

  const stepTitle = (step: CardStep): string => {
    const base = cards.dynamic(`steps.${step.action}.${step.target.entity}`, undefined, cards('steps.generic'));
    if (step.target.entity === 'roster' && step.target.count !== undefined) return `${base} (${cards('steps.players', { count: step.target.count })})`;
    if (step.target.entity === 'groups' && step.target.count !== undefined) return `${base} (${cards('steps.groups', { count: step.target.count })})`;
    return base;
  };

  const targetName = (target: CardTarget) =>
    target.name === null ? null : (
      <>
        <span className="font-semibold">{target.name.text}</span>
        {target.name.hidden > 0 && (
          <Badge variant="yellow" size="xs" className="ml-1">
            {cards('summary.hiddenCharacters', { count: target.name.hidden })}
          </Badge>
        )}
      </>
    );

  const lineView = (line: CardLine, index: number) => {
    const { key, params } = lineMessage(line);
    const hidden = Object.values(line.params ?? {}).reduce<number>((sum, param) => sum + hiddenOf(param), 0);
    return (
      <li key={`${line.kind}-${index}`}>
        {cards.dynamic(key, params, '')}
        {hidden > 0 && (
          <Badge variant="yellow" size="xs" className="ml-1">
            {cards('summary.hiddenCharacters', { count: hidden })}
          </Badge>
        )}
      </li>
    );
  };

  /** What an undo leaves alone, leaves behind or cannot do, each with its reason (spec §18.8). All words come from the catalog. */
  const undoNotes = (undo: NonNullable<StoredCard['undo']>) => {
    const groups = [
      ['leftAlone', undo.leftAlone],
      ['residue', undo.residue],
      ['notUndoable', undo.notUndoable],
    ] as const;
    return (
      <div className="space-y-2">
        {groups.map(([group, notes]) =>
          notes.length === 0 ? null : (
            <div key={group}>
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-muted">{cards.dynamic(`undo.${group}`, undefined, '')}</h4>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-poke-text-secondary">
                {notes.map((note, index) => (
                  <li key={`${note.op}-${note.id ?? 'x'}-${index}`}>
                    <span className="font-semibold">{cards.dynamic(`undo.ops.${note.op}`, undefined, cards('undo.ops.generic'))}</span>
                    {note.name !== null && <> {note.name.text}</>}
                    {': '}
                    {cards.dynamic(`undo.reasons.${note.reason}`, undefined, '')}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
        {undo.truncated && <p className="text-xs text-poke-text-muted">{cards('undo.truncated')}</p>}
      </div>
    );
  };
  /** One step of the result: its chip, what went wrong in a catalogued sentence, and a link to what it made. Nothing the model wrote. */
  const resultStep = (step: CardStep) => {
    const progress: StepView | undefined = stepStatus.get(step.key);
    const chip = progress === undefined ? 'notExecuted' : STEP_STATUS[progress.status];
    const code = progress?.errorCode ?? null;
    const counts = step.op === 'roster_add' && progress?.status !== 'ok' ? progress?.verify ?? null : null;
    const link = progress === undefined || progress.status === 'undone' ? null : entityLink(step.op, progress.entityId);
    let note: string | null = null;
    if (progress?.status === 'unknown') {
      note = code === 'ledger_unavailable' ? errorText({ code }) : code === 'reconcile_ambiguous' ? cards('result.step.ambiguous') : cards('result.step.unknown');
    } else if ((progress?.status === 'failed' || progress?.status === 'skipped') && code !== null) {
      note = errorText({ code });
    }
    return (
      <li key={step.key} className={`${PANEL_INSET} p-2 text-sm`} data-step={step.key} data-step-status={progress?.status ?? 'pending'}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading font-semibold">{stepTitle(step)}</span>
          {targetName(step.target)}
          <Badge variant={STATUS_VARIANT[chip]} size="xs">
            {cards(`status.${chip}`)}
          </Badge>
        </div>
        {note !== null && <p className={`mt-1 text-xs ${progress?.status === 'unknown' ? 'text-poke-text-secondary' : 'text-poke-danger-ink'}`}>{note}</p>}
        {counts !== null && counts.present > 0 && counts.present < counts.expected && (
          <p className="mt-1 text-xs text-poke-text-secondary">{cards('result.step.rosterPartial', { present: counts.present, count: counts.expected })}</p>
        )}
        {link !== null && (
          <p className="mt-1 text-xs">
            <Link href={link.href} className="font-semibold text-poke-focus underline-offset-2 hover:underline">
              {cards(`result.links.${link.key}`)}
            </Link>
          </p>
        )}
      </li>
    );
  };

  const decline = async () => {
    setBusy('decline');
    setActionError(null);
    const result = await declineProposal(proposalId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    await load();
    onChanged?.();
  };

  /** Shows the structured answer at once, then the stored state (the same ledger) replaces it. */
  const settle = async (result: ProposalResultView) => {
    // The answer is the server's; a shape that is not a result is left to the re-read below.
    if (Array.isArray(result.steps)) setDetail((current) => (current === null ? current : { ...current, card: withResult(current.card, result), token: null }));
    await load();
    onChanged?.();
  };

  const approve = async () => {
    if (detail.token === null) return;
    setBusy('approve');
    setActionError(null);
    try {
      const chosenAcks = acks.filter((ack) => (ack.kind === 'checkbox' ? ticked.has(ack.id) : ack.expected !== undefined && NFC(typed) === NFC(ack.expected.text)));
      const chosen = chosenAcks.map((ack) => ack.id);
      // The typed text goes with the request: the server compares it with the card too, the box here is only the friction.
      const typedNames = Object.fromEntries(chosenAcks.filter((ack) => ack.kind === 'typed_name').map((ack) => [ack.id, NFC(typed)]));
      const result = await approveProposal(proposalId, {
        token: detail.token,
        proposal_hash: card.proposalHash,
        preview_hash: card.previewHash,
        acks: chosen,
        ...(Object.keys(typedNames).length > 0 ? { typed: typedNames } : {}),
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await settle(result.data);
    } catch (error) {
      setActionError(toApiErrorLike(error));
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    setBusy('resume');
    setActionError(null);
    try {
      const result = await resumeProposal(proposalId);
      if (!result.ok) {
        setActionError(result.error);
        // A refusal (the window is over, the proposal moved on) changes what the card offers: read it again.
        await load();
        return;
      }
      await settle(result.data);
    } catch (error) {
      setActionError(toApiErrorLike(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${PANEL} space-y-3 p-3`} aria-labelledby={headingId} data-proposal-id={card.id} data-status={card.effectiveStatus}>
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={stored.class === 'G' ? 'accent' : 'default'}>{stored.class === 'G' ? cards('classes.goLive') : cards('classes.change')}</Badge>
        <h3 id={headingId} className="font-heading text-sm font-bold text-poke-text-primary">
          {stored.kind === 'go_live' ? cards('titles.goLive') : stored.kind === 'undo' ? cards('titles.undo') : cards('titles.build')}
        </h3>
        <Badge variant={STATUS_VARIANT[status]}>{cards(`status.${status}`)}</Badge>
        <span className="ml-auto text-xs text-poke-text-muted">
          {cards('details.planCode')} <code>{stored.planCode}</code>
        </span>
      </header>

      {loadError !== null && (
        <Alert variant="warning">
          {t('errors.refreshFailed')}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            {t('errors.retry')}
          </button>
        </Alert>
      )}
      {actionError !== null && <Alert variant="error">{errorText(actionError)}</Alert>}

      {resultStatus !== null && (
        <div className="space-y-2" data-result={resultStatus} aria-busy={resultStatus === 'executing' && busy !== null}>
          <div>
            <h4 className="font-heading text-sm font-semibold text-poke-text-primary">{cards.dynamic(`result.headline.${resultStatus}`, undefined, '')}</h4>
            <p className="text-xs text-poke-text-secondary">{cards.dynamic(`result.explain.${resultStatus}`, undefined, '')}</p>
          </div>
          <ol className="space-y-2" aria-label={cards('result.heading')}>
            {stored.steps.map(resultStep)}
          </ol>
          {card.resume !== null &&
            (card.resume.eligible ? (
              <div className="space-y-1">
                <p className="text-xs text-poke-text-secondary">{cards('result.resume.explain', { time: formatter.instant(card.resume.deadline, 'time') })}</p>
                <Button variant="primary" size="sm" disabled={!approveEnabled || busy !== null} loading={busy === 'resume'} onClick={() => void resume()}>
                  {cards('actions.resume')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-poke-text-secondary">{cards('result.resume.over')}</p>
            ))}
          {card.undoable && onUndo !== undefined && (
            <div className="space-y-1">
              <p className="text-xs text-poke-text-secondary">{cards('result.undoHint')}</p>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => onUndo(card.id)}>
                {cards('actions.undo')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!expanded ? (
        <Button size="sm" variant="ghost" aria-expanded={false} onClick={() => setOpen(true)}>
          {cards('card.show')}
        </Button>
      ) : (
        <>
          {stored.plan !== null && (
            <p className="text-sm text-poke-text-secondary">
              <span className="font-semibold">{cards('card.planTitle')}:</span> {stored.plan.title.text}{' '}
              <span className="text-xs text-poke-text-muted">({cards('card.assistantWritten')})</span>
            </p>
          )}
          <p className="text-xs text-poke-text-muted">
            {cards('build.steps', { count: stored.summary.steps })}
            {stored.summary.creates > 0 && ` · ${cards('build.creates', { count: stored.summary.creates })}`}
          </p>

          <ol className="space-y-2" aria-label={cards('card.steps')}>
            {stored.steps.map((step) => {
              return (
                <li key={step.key} className={`${PANEL_INSET} p-2 text-sm`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading font-semibold">{stepTitle(step)}</span>
                    {targetName(step.target)}
                  </div>
                  {step.items.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-poke-text-secondary" aria-label={cards('card.items')}>
                      {step.items.map((item, index) => (
                        <li key={`${item.entity}-${item.id ?? index}`}>{targetName(item)}</li>
                      ))}
                    </ul>
                  )}
                  {step.lines.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-poke-text-secondary">{step.lines.map(lineView)}</ul>}
                </li>
              );
            })}
          </ol>

          {stored.undo !== undefined && undoNotes(stored.undo)}

          {stored.lines.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-poke-text-secondary">{stored.lines.map(lineView)}</ul>}
          {stored.warnings.length > 0 && (
            <Alert variant="warning">
              <ul className="list-disc space-y-0.5 pl-4">{stored.warnings.map(lineView)}</ul>
            </Alert>
          )}
          {stored.existingEntity && <Alert variant="info">{cards('lines.existing_entity')}</Alert>}

          {stored.outwardEffects.length > 0 && (
            <div className="space-y-1">
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-muted">{cards('effects.heading')}</h4>
              <ul className="space-y-1 text-sm">
                {stored.outwardEffects.map((effect) => (
                  <li key={effect.key}>
                    {cards.dynamic(`effects.keys.${effect.key}`, undefined, cards('effects.generic'))}
                    {effect.channels.kind === 'unknown' && <span className="block text-xs text-poke-text-muted">{cards('effects.channelsUnknown')}</span>}
                    {effect.channels.kind === 'counted' && (
                      <span className="block text-xs text-poke-text-muted">
                        {cards('effects.channels', { count: effect.channels.discord + effect.channels.social })}
                        {effect.channels.names.length > 0 && `: ${effect.channels.names.map((name) => name.text).join(', ')}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-poke-text-secondary">
            {stored.reversibility.kind === 'undoable'
              ? cards('reversibility.undoAvailable')
              : cards('reversibility.irreversible', { reversal: cards(`reversibility.reasons.${stored.reversibility.reason}`) })}
          </p>

          {live && acks.length > 0 && (
            <fieldset className="space-y-2 rounded-poke-md border border-poke-border p-2">
              <legend className="px-1 font-heading text-xs font-semibold">{cards('ack.heading')}</legend>
              {acks.map((ack) =>
                ack.kind === 'checkbox' ? (
                  <label key={ack.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ticked.has(ack.id)}
                      onChange={(event) =>
                        setTicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(ack.id);
                          else next.delete(ack.id);
                          return next;
                        })
                      }
                    />
                    <span>{ackText(ack)}</span>
                  </label>
                ) : (
                  <Input
                    key={ack.id}
                    id={`${headingId}-typed`}
                    label={ackText(ack)}
                    value={typed}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                ),
              )}
              {!acksSatisfied && <p className="text-xs text-poke-text-muted">{cards('ack.required')}</p>}
            </fieldset>
          )}

          {live && <p className="text-xs text-poke-text-muted">{cards('expiry.expiresIn', { time: formatter.clock(secondsLeft) })}</p>}
          {actionable && secondsLeft === 0 && <p className="text-xs text-poke-text-muted">{cards('expiry.expired')}</p>}
          {live && !approveEnabled && <p className="text-xs text-poke-text-muted">{t('states.phaseOnly')}</p>}
          {live && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={!canApprove} loading={busy === 'approve'} onClick={() => void approve()}>
                {cards('actions.approve')}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy !== null} loading={busy === 'decline'} onClick={() => void decline()}>
                {cards('actions.decline')}
              </Button>
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer font-heading font-semibold text-poke-text-secondary">{cards('details.toggle')}</summary>
            <div className="mt-2 space-y-2">
              {card.details.map((step) => (
                <div key={step.key} className={`${PANEL_INSET} p-2`}>
                  <p>
                    <span className="font-semibold">{cards('details.method')}:</span> {step.method}
                  </p>
                  <p className="break-all">
                    <span className="font-semibold">{cards('details.path')}:</span> <code>{step.path}</code>
                  </p>
                  <p className="font-semibold">{cards('details.body')}:</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all">{step.body === null || step.body === undefined ? cards('details.empty') : JSON.stringify(step.body, null, 2)}</pre>
                </div>
              ))}
            </div>
          </details>

          {!actionable && (
            <Button size="sm" variant="ghost" aria-expanded onClick={() => setOpen(false)}>
              {cards('card.hide')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
