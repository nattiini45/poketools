'use client';

/**
 * Draft Kill Token card (draft-frontend §6.2; SPEC Prompt 7, BR-4).
 *
 * Window state (open until a cutoff or the first confirmed result, before the
 * Initial draft is complete, closed), `owned/max`, the unspent points, and per
 * own line its progress plus either a buy button or the reason it cannot get
 * a token (`draft/tokens.reason.<CODE>`, params from the DTO). Buying goes
 * through `ArmedConfirmDialog`; the `client_request_id` is minted when the
 * dialog opens and reused for retries of that dialog (idempotent, BE #26).
 */
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { refusalParams, visibleRefusal } from './token-view';
import { useLineText } from './use-line-text';
import { CARD, CARD_TITLE, NOTE } from './styles';

export interface DraftKillTokenCardProps {
  data: TokenOverviewDTO['draft_kill'];
  catalog: DraftLineCatalog;
  readOnly: boolean;
  /** Resolves with null on success (the dialog closes) or the API error (shown in the dialog). */
  onBuy(lineId: LineId, requestId: string): Promise<ApiErrorLike | null>;
}

interface Pending {
  lineId: LineId;
  requestId: string;
}

function WindowState({ data }: { data: TokenOverviewDTO['draft_kill'] }) {
  const t = useT(draftTokensMessages);
  if (data.window === 'before') return <p className={NOTE}>{t('dk.windowBefore')}</p>;
  if (data.window === 'closed') return <p className={NOTE}>{t('dk.windowClosed')}</p>;
  if (data.cutoff_at === null) return <p className="text-sm text-poke-text-secondary">{t('dk.windowOpenUntilResult')}</p>;
  const cutoff = data.cutoff_at;
  return (
    <p className="text-sm text-poke-text-secondary">
      {t.rich('dk.windowOpen', {
        time: () => <LocalTime value={cutoff} preset="weekdayDateTime" zone="both" className="font-semibold" />,
      })}
    </p>
  );
}

export default function DraftKillTokenCard({ data, catalog, readOnly, onBuy }: DraftKillTokenCardProps) {
  const t = useT(draftTokensMessages);
  const tGlossary = useT(glossaryMessages);
  const errorText = useApiErrorText(errorsDraft);
  const text = useLineText(catalog);

  const [pending, setPending] = useState<Pending | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const atLimit = data.owned >= data.max;
  const canBuy = !readOnly && data.window === 'open';

  const open = (lineId: LineId) => {
    setError(null);
    setPending({ lineId, requestId: crypto.randomUUID() });
  };

  const confirm = async () => {
    if (!pending) return;
    setSubmitting(true);
    const result = await onBuy(pending.lineId, pending.requestId);
    setSubmitting(false);
    if (result) setError(result);
    else setPending(null);
  };

  return (
    <section className={CARD} aria-labelledby="token-card-draft-kill">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="token-card-draft-kill" className={CARD_TITLE}>
          {tGlossary('token.draftKill')}
        </h2>
        <span className="text-sm font-semibold tabular-nums text-poke-text-primary">
          {t('dk.owned', { owned: data.owned, max: data.max })}
        </span>
      </div>
      <p className="text-sm text-poke-text-secondary">{t('dk.intro', { cost: data.cost, max: data.max })}</p>
      <WindowState data={data} />
      <p className="text-sm tabular-nums text-poke-text-primary">{t('dk.unspent', { n: data.unspent_points })}</p>
      {data.window === 'open' && atLimit ? (
        <p className={NOTE}>{t('reason.TOKEN_PLAYER_LIMIT', { max: data.max })}</p>
      ) : null}

      {data.lines.length === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('dk.noLines')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-poke-border">
          {data.lines.map((line) => {
            const label = text.label(line.line_id);
            const refusal = visibleRefusal(line);
            return (
              <li key={line.line_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-poke-text-primary">{label}</p>
                  <p className="text-xs tabular-nums text-poke-text-secondary">
                    {line.next_threshold === null
                      ? t('dk.progressMax', { progress: line.progress })
                      : t('dk.progress', { progress: line.progress, next: line.next_threshold })}
                  </p>
                  {refusal ? (
                    <p className="text-xs text-poke-amber-ink" data-reason={refusal}>
                      {t(`reason.${refusal}`, refusalParams(line, data))}
                    </p>
                  ) : null}
                </div>
                {line.has_token ? (
                  <span className="rounded-full border border-poke-border bg-poke-elevated px-2 py-0.5 text-xs text-poke-text-secondary">
                    {t('dk.hasToken')}
                  </span>
                ) : canBuy && line.eligible ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => open(line.line_id)}
                    aria-label={t('dk.buyFor', { line: label })}
                  >
                    {t('dk.buy', { cost: data.cost })}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ArmedConfirmDialog
        open={pending !== null}
        title={pending ? t('dk.confirmTitle', { line: text.label(pending.lineId) }) : ''}
        body={t('dk.confirmBody', { cost: data.cost })}
        confirmLabel={t('dk.confirm')}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
        submitting={submitting}
        error={error ? errorText(error) : null}
      />
    </section>
  );
}
