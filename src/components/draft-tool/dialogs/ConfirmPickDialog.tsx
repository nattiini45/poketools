'use client';

/**
 * Pick confirmation (draft-frontend §5.6), built on the shared
 * `ArmedConfirmDialog`: Cancel has focus on open (Enter cancels), Confirm
 * stays grey for `CONFIRM_ARM_MS` after every open and after every failure,
 * no hold and no typing (SPEC:494-497).
 *
 * The parent keys this component by the dialog's open count, so the slot
 * choice and the admin reason start fresh on every open; the
 * `client_request_id` lives in the parent's pick flow (minted per open,
 * reused by Retry).
 */
import { useState } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { RedraftSlotVM } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import ArmedConfirmDialog from '../shared/ArmedConfirmDialog';
import { overrideReasonValid, OVERRIDE_REASON_MIN } from '../hooks/pick-flow';
import RedraftSlotChooser from './RedraftSlotChooser';

export interface ConfirmPickDialogProps {
  open: boolean;
  onCancel(): void;
  entry: DraftLineCatalogEntry;
  price: number;
  remainingAfter: number | null;
  /** Non-null in a redraft with open slots. */
  redraftSlots: RedraftSlotVM[] | null;
  /** Admin "pick for" mode. */
  adminOverride: { targetName: string } | null;
  submitting: boolean;
  error: ApiErrorLike | null;
  /** The last failure was a network error: the confirm button reads "Retry" (same request id). */
  retryable?: boolean;
  onConfirm(input: { redraftSlotId: string | null; overrideReason: string | null }): void;
  /** Resolves redraft slots' dropped lines for their labels. */
  entryOf?(lineId: LineId): DraftLineCatalogEntry | undefined;
}

/**
 * The violet DRAFT colours on the shared dialog's confirm button (DF2a handoff). Tailwind utilities rather
 * than `styles.cta`: that class also carries the 56px full-width DRAFT geometry and would fight the
 * Button's own colour classes by stylesheet order, while these replace them through tailwind-merge. The
 * dialog is portalled outside `.root`, so each `--draft-cta*` token falls back to its spec hex
 * (draft-tool.module.css); disabled (arming) is grey like `.cta:disabled`, not a faded violet.
 */
const CONFIRM_CTA_CLASS = [
  'border-[color:var(--draft-cta,#7C3AED)] bg-[color:var(--draft-cta,#7C3AED)] text-[color:var(--draft-cta-ink,#FFFFFF)]',
  'hover:border-[color:var(--draft-cta-hover,#8B5CF6)] hover:bg-[color:var(--draft-cta-hover,#8B5CF6)]',
  'active:border-[color:var(--draft-cta-pressed,#6D28D9)] active:bg-[color:var(--draft-cta-pressed,#6D28D9)]',
  'disabled:opacity-100 disabled:border-[color:var(--draft-cta-disabled-bg,var(--poke-muted))]',
  'disabled:bg-[color:var(--draft-cta-disabled-bg,var(--poke-muted))]',
  'disabled:text-[color:var(--draft-cta-disabled-ink,var(--poke-text-muted))]',
].join(' ');

export default function ConfirmPickDialog({
  open,
  onCancel,
  entry,
  price,
  remainingAfter,
  redraftSlots,
  adminOverride,
  submitting,
  error,
  retryable = false,
  onConfirm,
  entryOf = () => undefined,
}: ConfirmPickDialogProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const dl = useDataLocale();
  const errorText = useApiErrorText(errorsDraft);

  const openSlots = (redraftSlots ?? []).filter((s) => s.open);
  const [slotId, setSlotId] = useState<string | null>(openSlots.length === 1 ? openSlots[0].redraftSlotId : null);
  const [reason, setReason] = useState('');

  const base = pkmnNameResolver.species(entry.stages[0].name, dl);
  const line = pkmnNameResolver.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl);
  const needsSlot = openSlots.length > 0;
  const slotMissing = needsSlot && slotId === null;
  const reasonMissing = adminOverride !== null && !overrideReasonValid(reason);

  const title = adminOverride
    ? t('confirm.titleFor', { line, player: adminOverride.targetName })
    : t('confirm.title', { line });

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-center gap-2" aria-hidden="true">
        {entry.stages.map((s, i) => (
          <PokemonSprite key={s.stage} name={s.name} size={i === entry.stages.length - 1 ? 72 : 56} />
        ))}
      </div>
      <p className="flex flex-wrap items-baseline justify-center gap-x-3">
        <span className="text-lg font-bold text-poke-text-primary">{tShared('points', { n: price })}</span>
        {remainingAfter !== null ? <span>{t('cost.remaining', { n: remainingAfter })}</span> : null}
      </p>
      <p>{adminOverride ? t('confirm.bodyAdmin', { player: adminOverride.targetName }) : t('confirm.body')}</p>
    </div>
  );

  return (
    <ArmedConfirmDialog
      open={open}
      title={title}
      body={body}
      confirmLabel={retryable ? t('confirm.retry') : t('confirm.confirm', { base, price })}
      onConfirm={() => onConfirm({ redraftSlotId: needsSlot ? slotId : null, overrideReason: adminOverride ? reason.trim() : null })}
      onCancel={onCancel}
      submitting={submitting}
      error={error ? errorText(error) : null}
      confirmDisabled={slotMissing || reasonMissing}
      confirmClassName={CONFIRM_CTA_CLASS}
    >
      {needsSlot ? (
        <RedraftSlotChooser slots={openSlots} value={slotId} onChange={setSlotId} entryOf={entryOf} disabled={submitting} />
      ) : null}
      {adminOverride ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-poke-text-primary">{t('confirm.reason')}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            required
            minLength={OVERRIDE_REASON_MIN}
            disabled={submitting}
            aria-invalid={reasonMissing && reason.length > 0 ? true : undefined}
            className="rounded-lg border border-poke-border bg-poke-surface px-3 py-2 text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
          />
          <span className="text-xs text-poke-text-secondary">{t('confirm.reasonHint')}</span>
        </label>
      ) : null}
    </ArmedConfirmDialog>
  );
}
