'use client';

/**
 * Comeback Token card (draft-frontend §6.2; SPEC:833-841, BR-5).
 *
 * Balance (earned / spent / unspent) and the history (matchday, score, +n).
 * Before spending opens (the Redraft is complete, or an admin opened it):
 * `cb.locked`. Once open: a stepper per line (several tokens per line, split
 * across lines, 0..unspent; on a line that needs several tokens per progress
 * point the stepper moves by that many and shows `cb.ratioHint`), a live
 * preview of the resulting progress and a
 * `cb.willEvolve {form}` badge — a Comeback Token may evolve a line, unlike a
 * Draft Kill Token. Confirm through `ArmedConfirmDialog`; the request id is
 * minted per dialog open and reused for its retries (idempotent, BE #27).
 *
 * State holds line ids and counts, never translated text.
 */
import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import {
  allocatedTotal,
  catalogById,
  comebackPreview,
  comebackStep,
  maxForLine,
  toAllocations,
  type ComebackAllocation,
} from './token-view';
import { useLineText } from './use-line-text';
import { CARD, CARD_TITLE, NOTE } from './styles';

export interface ComebackTokenCardProps {
  data: TokenOverviewDTO['comeback'];
  lines: TokenOverviewDTO['lines'];
  catalog: DraftLineCatalog;
  readOnly: boolean;
  /** Resolves with null on success (the allocation resets) or the API error (shown in the dialog). */
  onSpend(allocs: ComebackAllocation[], requestId: string): Promise<ApiErrorLike | null>;
}

const STEP =
  'inline-flex h-11 w-11 items-center justify-center rounded-lg border border-poke-border bg-poke-surface text-poke-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus';

function Balance({ data }: { data: TokenOverviewDTO['comeback'] }) {
  const t = useT(draftTokensMessages);
  const cells: { key: 'earned' | 'spent' | 'unspent'; n: number }[] = [
    { key: 'earned', n: data.earned },
    { key: 'spent', n: data.spent },
    { key: 'unspent', n: data.unspent },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {cells.map((c) => (
        <div key={c.key} className="rounded-lg border border-poke-border bg-poke-elevated px-2 py-1.5">
          <dt className="text-xs text-poke-text-secondary">{t(`cb.${c.key}`)}</dt>
          <dd className="text-lg font-bold tabular-nums text-poke-text-primary">{c.n}</dd>
        </div>
      ))}
    </dl>
  );
}

function History({ history }: { history: TokenOverviewDTO['comeback']['history'] }) {
  const t = useT(draftTokensMessages);
  if (history.length === 0) return <p className="text-sm text-poke-text-secondary">{t('cb.noHistory')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-poke-text-primary">{t('cb.historyTitle')}</caption>
        <thead>
          <tr className="text-left text-xs text-poke-text-secondary">
            <th scope="col" className="py-1 pr-3 font-medium">{t('cb.matchday')}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{t('cb.score')}</th>
            <th scope="col" className="py-1 font-medium">{t('cb.tokens')}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {history.map((h, i) => (
            <tr key={`${h.matchday}-${i}`} className="border-t border-poke-border">
              <td className="py-1 pr-3">{h.matchday}</td>
              <td className="py-1 pr-3">{h.score}</td>
              <td className="py-1">{t('cb.historyTokens', { n: h.tokens })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComebackTokenCard({ data, lines, catalog, readOnly, onSpend }: ComebackTokenCardProps) {
  const t = useT(draftTokensMessages);
  const tGlossary = useT(glossaryMessages);
  const errorText = useApiErrorText(errorsDraft);
  const text = useLineText(catalog);
  const byId = useMemo(() => catalogById(catalog), [catalog]);

  const [counts, setCounts] = useState<ReadonlyMap<LineId, number>>(() => new Map());
  const [pending, setPending] = useState<{ requestId: string; allocs: ComebackAllocation[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  // A fully evolved line has nothing left to progress.
  const spendable = useMemo(() => lines.filter((l) => l.next_threshold !== null), [lines]);
  const total = allocatedTotal(counts);
  const left = Math.max(0, data.unspent - total);
  const canSpend = !readOnly && data.spend_open && data.unspent > 0;

  const setCount = (lineId: LineId, n: number) => {
    setCounts((prev) => {
      const next = new Map(prev);
      if (n <= 0) next.delete(lineId);
      else next.set(lineId, n);
      return next;
    });
  };

  const openConfirm = () => {
    const allocs = toAllocations(
      counts,
      spendable.map((l) => l.line_id),
    );
    if (allocs.length === 0) return;
    setError(null);
    setPending({ requestId: crypto.randomUUID(), allocs });
  };

  const confirm = async () => {
    if (!pending) return;
    setSubmitting(true);
    const result = await onSpend(pending.allocs, pending.requestId);
    setSubmitting(false);
    if (result) {
      setError(result);
      return;
    }
    setPending(null);
    setCounts(new Map());
  };

  return (
    <section className={CARD} aria-labelledby="token-card-comeback">
      <h2 id="token-card-comeback" className={CARD_TITLE}>
        {tGlossary('token.comeback')}
      </h2>
      <p className="text-sm text-poke-text-secondary">{t('cb.intro')}</p>
      {data.earn_window === 'first_half' ? (
        <p className="text-xs text-poke-text-secondary">{t('cb.earnFirstHalf')}</p>
      ) : null}
      <Balance data={data} />
      <History history={data.history} />

      {!data.spend_open ? (
        <p className={NOTE}>{t('cb.locked')}</p>
      ) : data.unspent === 0 ? (
        <p className={NOTE}>{t('cb.nothingToSpend')}</p>
      ) : canSpend ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-poke-text-primary">{t('cb.allocTitle')}</h3>
          <p className="text-xs text-poke-text-secondary">{t('cb.allocHint')}</p>
          <ul className="flex flex-col divide-y divide-poke-border">
            {spendable.map((line) => {
              const n = counts.get(line.line_id) ?? 0;
              const step = comebackStep(line);
              const max = maxForLine(counts, line.line_id, data.unspent, step);
              const label = text.label(line.line_id);
              const preview = comebackPreview(line, n, byId.get(line.line_id));
              return (
                <li key={line.line_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-poke-text-primary">{label}</p>
                    <p className="text-xs tabular-nums text-poke-text-secondary">
                      {preview.next === null
                        ? t('cb.previewMax', { from: preview.from, to: preview.to })
                        : t('cb.preview', { from: preview.from, to: preview.to, next: preview.next })}
                    </p>
                    {step > 1 ? (
                      <p className="text-xs text-poke-text-secondary">{t('cb.ratioHint', { ratio: step })}</p>
                    ) : null}
                    {preview.evolvesTo ? (
                      <span className="mt-1 inline-block rounded-full border border-poke-accent bg-poke-elevated px-2 py-0.5 text-xs font-semibold text-poke-text-primary">
                        {t('cb.willEvolve', { form: text.species(preview.evolvesTo) })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={STEP}
                      onClick={() => setCount(line.line_id, n - step)}
                      disabled={n === 0 || submitting}
                      aria-label={t('cb.decrease', { count: step, line: label })}
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <output
                      className="w-8 text-center text-lg font-bold tabular-nums text-poke-text-primary"
                      aria-label={t('cb.allocated', { count: n, line: label })}
                      aria-live="polite"
                    >
                      {n}
                    </output>
                    <button
                      type="button"
                      className={STEP}
                      onClick={() => setCount(line.line_id, n + step)}
                      disabled={n + step > max || submitting}
                      aria-label={t('cb.increase', { count: step, line: label })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm tabular-nums text-poke-text-secondary">{t('cb.left', { count: left })}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCounts(new Map())} disabled={total === 0}>
                {t('cb.reset')}
              </Button>
              <Button type="button" size="sm" onClick={openConfirm} disabled={total === 0}>
                {t('cb.spend', { count: total })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ArmedConfirmDialog
        open={pending !== null}
        title={t('cb.confirmTitle')}
        body={
          <div className="flex flex-col gap-2">
            <p>{t('cb.confirmBody')}</p>
            <ul className="list-disc pl-5">
              {(pending?.allocs ?? []).map((a) => {
                const line = lines.find((l) => l.line_id === a.line_id);
                const preview = line ? comebackPreview(line, a.tokens, byId.get(a.line_id)) : null;
                const ratio = line ? comebackStep(line) : 1;
                return (
                  <li key={a.line_id}>
                    {ratio > 1
                      ? t('cb.confirmLineRatio', {
                          line: text.label(a.line_id),
                          tokens: a.tokens,
                          n: preview?.added ?? Math.floor(a.tokens / ratio),
                        })
                      : t('cb.confirmLine', { line: text.label(a.line_id), n: a.tokens })}
                    {preview?.evolvesTo ? ` · ${t('cb.willEvolve', { form: text.species(preview.evolvesTo) })}` : null}
                  </li>
                );
              })}
            </ul>
          </div>
        }
        confirmLabel={t('cb.confirm')}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
        submitting={submitting}
        error={error ? errorText(error) : null}
      />
    </section>
  );
}
