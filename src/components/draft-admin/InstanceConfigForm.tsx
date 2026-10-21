'use client';

/**
 * The pool's settings (draft-frontend §7.1, §7.2): DC-0 `DraftConfigInput`
 * fields, prefilled from the snapshot. Only changed fields are sent: an
 * initial pool saves through BE #3 in setup; a redraft in its submission
 * phase sends `redraft_max_lines` / `participant_order` through BE #21 and
 * the clock settings through BE #3. Disabled after the start. Client checks
 * mirror BE §8.2 (`invalidDraftConfigField`); the server is authoritative.
 * The deadline of a redraft is edited in `RedraftPhaseManager`.
 */
import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Button from '@/components/ui/Button';
import { LocalTime } from '@/i18n/LocalTime';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { formatDuration } from '@/lib/draft-ui/clock';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftConfigInput, DraftMode, DraftSnapshotDTO } from '@/types/draft-queue';
import type { RedraftPatch } from './admin-actions';
import { FIELD, HINT, InlineError, InlineNotice, LABEL, usePrimaryButton } from './admin-ui';
import {
  configChanges,
  configEditable,
  configFormFromSnapshot,
  defaultPickSeconds,
  hasChanges,
  invalidConfigField,
  localInputToIso,
  moveItem,
  type ConfigFormState,
} from './admin-view';
import { useAdminCall, type AdminResult } from './use-admin-call';

export interface InstanceConfigFormProps {
  vm: DraftViewModel;
  /** Prefill source (the snapshot carries the stored config). */
  dto: DraftSnapshotDTO;
  onSaveConfig(input: DraftConfigInput): AdminResult;
  onPatchRedraft(body: RedraftPatch): AdminResult;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  );
}

function secondsOf(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

export default function InstanceConfigForm({ vm, dto, onSaveConfig, onPatchRedraft }: InstanceConfigFormProps) {
  const t = useT(draftAdminMessages);
  const primary = usePrimaryButton();
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const errorText = useApiErrorText(errorsDraft);
  const call = useAdminCall();
  const ids = {
    mode: useId(),
    roster: useId(),
    budget: useId(),
    pick: useId(),
    makeup: useId(),
    ext: useId(),
    max: useId(),
    cutoff: useId(),
  };

  const [baseline, setBaseline] = useState<ConfigFormState>(() => configFormFromSnapshot(dto));
  const [form, setForm] = useState<ConfigFormState>(baseline);
  const [notice, setNotice] = useState<'saved' | 'noChanges' | null>(null);

  const editable = configEditable(vm);
  const disabled = !editable || call.busy;
  const kind = vm.kind;
  const invalid = editable ? invalidConfigField(form, vm.ladderSeconds) : null;
  const names = new Map(vm.participants.map((p) => [p.player_id, p]));

  const set = <K extends keyof ConfigFormState>(key: K, value: ConfigFormState[K]) => {
    setNotice(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setMode = (mode: DraftMode) => {
    setNotice(null);
    setForm((prev) => ({
      ...prev,
      mode,
      // A pick time the admin did not touch follows the mode's default.
      pick_seconds: prev.pick_seconds === baseline.pick_seconds ? String(defaultPickSeconds(mode)) : prev.pick_seconds,
    }));
  };

  const durationHint = (text: string) => {
    const s = secondsOf(text);
    return s === null ? null : t('config.duration', { duration: formatDuration(s, tShared) });
  };

  const save = async () => {
    const changes = configChanges(baseline, form, kind);
    if (!hasChanges(changes)) {
      setNotice('noChanges');
      return;
    }
    const ok = await call.run(async () => {
      if (Object.keys(changes.config).length > 0) {
        const err = await onSaveConfig(changes.config);
        if (err) return err;
      }
      if (Object.keys(changes.redraft).length > 0) return onPatchRedraft(changes.redraft);
      return null;
    });
    if (ok) {
      setBaseline(form);
      setNotice('saved');
    }
  };

  const cutoffIso = localInputToIso(form.token_purchase_closes_at);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!editable ? <p className="text-sm text-poke-text-secondary">{t('config.locked')}</p> : null}

      <fieldset disabled={disabled} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={ids.mode} label={t('config.mode')}>
          <select
            id={ids.mode}
            value={form.mode}
            onChange={(e) => setMode(e.target.value === 'slow' ? 'slow' : 'live')}
            className={FIELD}
          >
            <option value="live">{tGlossary('draft.liveDraft')}</option>
            <option value="slow">{tGlossary('draft.slowDraft')}</option>
          </select>
        </Field>
        <Field id={ids.roster} label={t('config.rosterSize')}>
          <input
            id={ids.roster}
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={form.roster_size}
            onChange={(e) => set('roster_size', e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field id={ids.budget} label={t('config.budget')}>
          <input
            id={ids.budget}
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={form.budget}
            onChange={(e) => set('budget', e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field id={ids.pick} label={t('config.pickSeconds')} hint={durationHint(form.pick_seconds)}>
          <input
            id={ids.pick}
            type="number"
            inputMode="numeric"
            min={form.mode === 'slow' ? 600 : 30}
            value={form.pick_seconds}
            onChange={(e) => set('pick_seconds', e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field id={ids.makeup} label={t('config.makeupSeconds')} hint={durationHint(form.makeup_seconds)}>
          <input
            id={ids.makeup}
            type="number"
            inputMode="numeric"
            min={30}
            value={form.makeup_seconds}
            onChange={(e) => set('makeup_seconds', e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field
          id={ids.max}
          label={t('config.redraftMaxLines')}
          hint={kind === 'redraft' ? t('config.redraftMaxLinesHint') : null}
        >
          <input
            id={ids.max}
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            value={form.redraft_max_lines}
            onChange={(e) => set('redraft_max_lines', e.target.value)}
            className={FIELD}
          />
        </Field>

        {form.mode === 'live' ? (
          <label htmlFor={ids.ext} className="flex items-center gap-2 text-sm text-poke-text-primary sm:col-span-2">
            <input
              id={ids.ext}
              type="checkbox"
              checked={form.extensions_enabled}
              onChange={(e) => set('extensions_enabled', e.target.checked)}
            />
            {t('config.extensionsEnabled')}
          </label>
        ) : (
          <div className="space-y-1 sm:col-span-2">
            <p className={LABEL}>{t('config.ladder')}</p>
            <ul className="flex flex-wrap gap-2 text-sm">
              {vm.ladderSeconds.map((secs, i) => (
                <li key={i} className="rounded-poke-sm border border-poke-border px-2 py-0.5">
                  {t('config.ladderStage', { stage: i + 1, duration: formatDuration(secs, tShared) })}
                </li>
              ))}
            </ul>
            <p className={HINT}>{t('config.ladderHint')}</p>
          </div>
        )}

        {kind === 'initial' ? (
          <Field
            id={ids.cutoff}
            label={t('config.tokenCutoff')}
            hint={
              cutoffIso ? <LocalTime value={cutoffIso} preset="weekdayDateTime" zone="both" /> : t('config.tokenCutoffHint')
            }
          >
            <div className="flex gap-2">
              <input
                id={ids.cutoff}
                type="datetime-local"
                value={form.token_purchase_closes_at}
                onChange={(e) => set('token_purchase_closes_at', e.target.value)}
                className={FIELD}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => set('token_purchase_closes_at', '')}>
                {t('config.clear')}
              </Button>
            </div>
          </Field>
        ) : null}

        <div className="space-y-1 sm:col-span-2">
          <p className={LABEL}>{t('config.order')}</p>
          <p className={HINT}>{kind === 'redraft' ? t('config.orderRedraftHint') : t('config.orderHint')}</p>
          <ol className="space-y-1">
            {form.participant_order.map((playerId, index) => {
              const p = names.get(playerId);
              const name = p?.name ?? playerId;
              return (
                <li
                  key={playerId}
                  className="flex items-center gap-2 rounded-poke-md border border-poke-border px-2 py-1 text-sm"
                >
                  <span className="w-16 text-poke-text-secondary">{t('config.seat', { n: index + 1 })}</span>
                  <span className="flex-1 font-semibold">{name}</span>
                  {p?.standing_rank != null ? (
                    <span className={HINT}>{t('config.standing', { rank: p.standing_rank })}</span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('config.moveUp', { name })}
                    disabled={disabled || index === 0}
                    onClick={() => set('participant_order', moveItem(form.participant_order, index, -1))}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('config.moveDown', { name })}
                    disabled={disabled || index === form.participant_order.length - 1}
                    onClick={() => set('participant_order', moveItem(form.participant_order, index, 1))}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      </fieldset>

      <InlineError text={invalid ? t(`config.invalid.${invalid}`) : null} />
      <InlineError text={call.error ? errorText(call.error) : null} />
      <InlineNotice text={notice === 'saved' ? t('config.saved') : notice === 'noChanges' ? t('config.noChanges') : null} />
      {editable ? (
        <Button type="submit" variant={primary.variant} className={primary.className} disabled={disabled || invalid !== null}>
          {t('config.save')}
        </Button>
      ) : null}
    </form>
  );
}
