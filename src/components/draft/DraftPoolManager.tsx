'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { errorsDraftLegacy } from '@/i18n/messages/errors/draft-legacy';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import { isPickOrderAllowed, pricingOfDraftType } from '@/lib/draft/pool-format';
import { postDraftCreate, type DraftCreateError, type DraftCreateOutcome } from '@/lib/draft-ui/create-pool';
import { DRAFT_PICK_ORDERS, type DraftPickOrder, type DraftType } from '@/types/draft';

/** The legacy `POST /api/drafts` body (`draftPoolCreateSchema`). */
export interface PoolCreateBody {
  season_id: string;
  /** Pricing: snake = no points, budget = fixed costs, auction = bids. */
  draft_type: DraftType;
  /** Turn order; omitted = what draft_type implied before the split (the route derives it). */
  pick_order?: DraftPickOrder;
  budget?: number;
  default_point_cost?: number;
}

/** The order a pool is created with: the admin's choice, except that an auction always runs in free order. */
export function effectivePickOrder(draftType: DraftType, chosen: DraftPickOrder): DraftPickOrder {
  return isPickOrderAllowed(draftType, chosen) ? chosen : 'free';
}

/**
 * Builds the create body: the pick order when given (forced to free for an auction), the budget
 * only for auction/budget pools, the default price only for budget pools of a non-point-buy season
 * and only when filled in (empty = the pool keeps no default, so an unpriced Pokémon costs 0).
 * Point-buy seasons price picks from their point-buy list; the route refuses a default price for them.
 */
export function buildPoolCreateBody(
  seasonId: string,
  draftType: DraftType,
  pointBudget: number,
  defaultPrice: string,
  opts: { pointBuy?: boolean; pickOrder?: DraftPickOrder } = {},
): PoolCreateBody {
  const body: PoolCreateBody = { season_id: seasonId, draft_type: draftType };
  if (opts.pickOrder) body.pick_order = effectivePickOrder(draftType, opts.pickOrder);
  if (draftType === 'auction' || draftType === 'budget') body.budget = pointBudget;
  if (draftType === 'budget' && !opts.pointBuy && defaultPrice.trim() !== '') {
    body.default_point_cost = Number(defaultPrice);
  }
  return body;
}

/**
 * A number input's state: its `value` plus `validity.badInput`. A browser can
 * hold text it cannot parse (e.g. `1e` or `-`) while `value` reads `''`, so an
 * empty value alone does not mean the field was left empty.
 */
export interface NumberFieldState {
  value: string;
  badInput: boolean;
}

/** Why a pool-create field is invalid; each maps to `poolManager.errors.*`. */
export type PoolFieldError = 'budgetInvalid' | 'priceInvalid' | 'priceAboveBudget';

/** The value as a whole number in `min..LEGACY_POINTS_MAX`, or null when it is not one. */
function parsePoints(value: string, min: number): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= LEGACY_POINTS_MAX ? n : null;
}

/**
 * The point budget: a whole number from 1 to `LEGACY_POINTS_MAX`. The create
 * schema's ceiling is the same; its floor is 0, but a pool with a budget of 0
 * could draft nothing and a point-buy season ignores a budget below 1.
 */
export function validatePoolBudget(field: NumberFieldState): PoolFieldError | null {
  if (field.badInput) return 'budgetInvalid';
  return parsePoints(field.value, 1) === null ? 'budgetInvalid' : null;
}

/**
 * The default price: empty = no default; otherwise a whole number from 0 to
 * `LEGACY_POINTS_MAX` and not above the pool's budget (`budget` null = no valid
 * budget to compare against).
 */
export function validateDefaultPrice(field: NumberFieldState, budget: number | null): PoolFieldError | null {
  if (field.badInput) return 'priceInvalid';
  if (field.value.trim() === '') return null;
  const price = parsePoints(field.value, 0);
  if (price === null) return 'priceInvalid';
  if (budget !== null && price > budget) return 'priceAboveBudget';
  return null;
}

/** The field errors of the create form; only the fields the chosen draft type shows are checked. */
export function validatePoolCreateForm(input: {
  draftType: DraftType;
  budget: NumberFieldState;
  defaultPrice: NumberFieldState;
  pointBuy?: boolean;
}): { budget: PoolFieldError | null; defaultPrice: PoolFieldError | null; valid: boolean } {
  const needsBudget = input.draftType === 'auction' || input.draftType === 'budget';
  const budget = needsBudget ? validatePoolBudget(input.budget) : null;
  const showsPrice = showsDefaultPriceField(input.draftType, input.pointBuy);
  const budgetValue = needsBudget && budget === null ? parsePoints(input.budget.value, 1) : null;
  const defaultPrice = showsPrice ? validateDefaultPrice(input.defaultPrice, budgetValue) : null;
  return { budget, defaultPrice, valid: budget === null && defaultPrice === null };
}

/** An untouched, empty number field. */
export const EMPTY_NUMBER_FIELD: NumberFieldState = Object.freeze({ value: '', badInput: false });

/** True when the create form shows the default-price field for this draft type. */
export function showsDefaultPriceField(draftType: DraftType, pointBuy = false): boolean {
  return draftType === 'budget' && !pointBuy;
}

/**
 * The default-price state once the field's visibility is known: kept while the
 * field is shown, reset to empty when it is hidden. A hidden input unmounts, so
 * a `badInput` flag (or value) left in state would otherwise come back with the
 * field as an error over an empty input and keep Create disabled.
 */
export function defaultPriceForVisibility(current: NumberFieldState, shown: boolean): NumberFieldState {
  return shown ? current : EMPTY_NUMBER_FIELD;
}

/** The ids of the budget/price fields, derived from one `useId()` value so two forms on a page never collide. */
export function poolFieldIds(baseId: string) {
  return {
    budget: `${baseId}-point-budget`,
    budgetError: `${baseId}-point-budget-error`,
    price: `${baseId}-default-price`,
    priceHint: `${baseId}-default-price-hint`,
    priceError: `${baseId}-default-price-error`,
  };
}

/** A number input's value and validity, read from its change/input event. */
function readNumberField(target: HTMLInputElement): NumberFieldState {
  return { value: target.value, badInput: target.validity?.badInput ?? false };
}

const INPUT_CLASS =
  'w-32 px-3 py-1.5 border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors';

interface DraftPoolManagerProps {
  seasonId: string;
  seasonName: string;
  existingPoolId?: string;
  onCreated?: () => void;
  /**
   * A point-buy (EPB) season: picks are priced from its point-buy list, so the
   * default-price field is hidden and never sent.
   */
  pointBuy?: boolean;
}

/** Display order of the pricing options (`draft_type` values); labels live in `poolManager.pricings`. */
const PRICINGS: readonly DraftType[] = ['snake', 'budget', 'auction'];

/**
 * Creates the draft pool of a plain `draft` season (legacy engine, `src/lib/draft/engine.ts`) in two
 * steps: the pick order (`pick_order`: snake, same order every round, or free) and the pricing
 * (`draft_type`: no points, fixed costs, or auction bids). An auction forces free order. The admin
 * league page creates EPB drafts with `EpbDraftRoomCreate` instead.
 */
export default function DraftPoolManager({
  seasonId,
  seasonName,
  existingPoolId,
  onCreated,
  pointBuy = false,
}: DraftPoolManagerProps) {
  const t = useT(draftLegacyBoardMessages);
  const apiErrorText = useApiErrorText(errorsDraft, errorsDraftLegacy);
  const router = useRouter();
  const idBase = useId();
  const [pickOrder, setPickOrder] = useState<DraftPickOrder>('snake');
  const [draftType, setDraftType] = useState<DraftType>('snake');
  const [pointBudget, setPointBudget] = useState<NumberFieldState>({ value: '100', badInput: false });
  const [defaultPrice, setDefaultPrice] = useState<NumberFieldState>({ value: '', badInput: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DraftCreateError | null>(null);

  const needsBudget = draftType === 'auction' || draftType === 'budget';
  const order = effectivePickOrder(draftType, pickOrder);
  const pricing = pricingOfDraftType(draftType);
  const showsDefaultPrice = showsDefaultPriceField(draftType, pointBuy);
  // The price field hides on a draft-type change or a `pointBuy` change alike: reset its state on
  // the visibility change itself (React's adjust-state-during-render pattern), whatever caused it.
  const [priceFieldShown, setPriceFieldShown] = useState(showsDefaultPrice);
  if (priceFieldShown !== showsDefaultPrice) {
    setPriceFieldShown(showsDefaultPrice);
    setDefaultPrice((current) => defaultPriceForVisibility(current, showsDefaultPrice));
  }
  const fieldErrors = validatePoolCreateForm({ draftType, budget: pointBudget, defaultPrice, pointBuy });

  function fieldErrorText(err: PoolFieldError): string {
    switch (err) {
      case 'budgetInvalid':
        return t('poolManager.errors.budgetInvalid', { max: LEGACY_POINTS_MAX });
      case 'priceInvalid':
        return t('poolManager.errors.priceInvalid', { max: LEGACY_POINTS_MAX });
      case 'priceAboveBudget':
        return t('poolManager.errors.priceAboveBudget', { budget: Number(pointBudget.value) });
    }
  }

  async function handleCreate() {
    if (!fieldErrors.valid) return;
    setLoading(true);
    setError(null);
    const body = buildPoolCreateBody(seasonId, draftType, Number(pointBudget.value), defaultPrice.value, {
      pointBuy,
      pickOrder,
    });
    let outcome: DraftCreateOutcome;
    try {
      outcome = await postDraftCreate(body);
    } catch (err) {
      setError({ kind: 'api', error: toApiErrorLike(err) });
      return;
    } finally {
      // Re-enable the button whatever happens, without leaning on the helper's never-throws contract.
      setLoading(false);
    }
    if (!outcome.created) {
      setError(outcome.error);
      return;
    }
    // The pool exists from here on, so nothing below may report a create failure. The page shows
    // the created pool instead of this form only after a server re-render.
    onCreated?.();
    router.refresh();
  }

  if (existingPoolId) {
    return (
      <Alert variant="success">
        <p className="text-sm">
          {t.rich('poolManager.exists', { season: seasonName, b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </Alert>
    );
  }

  return (
    <Card variant="default" padding="md" className="space-y-4">
      <h3 className="font-heading font-semibold text-lg text-poke-text-primary">{t('poolManager.create')}</h3>
      <p className="text-sm text-poke-text-muted">
        {t.rich('poolManager.setupFor', { season: seasonName, b: (chunks) => <strong>{chunks}</strong> })}
      </p>

      {/* Step 1: pick order. Auction pricing forces Free; the other orders are disabled then. */}
      <OptionGroup
        idBase={`${idBase}-order`}
        heading={t('poolManager.orderHeading')}
        note={draftType === 'auction' ? t('poolManager.auctionNeedsFree') : null}
        options={DRAFT_PICK_ORDERS.map((value) => ({
          value,
          name: t(`poolManager.orders.${value}.name`),
          description: t(`poolManager.orders.${value}.description`),
          disabled: !isPickOrderAllowed(draftType, value),
        }))}
        selected={order}
        onSelect={setPickOrder}
      />

      {/* Step 2: pricing (draft_type). */}
      <OptionGroup
        idBase={`${idBase}-pricing`}
        heading={t('poolManager.pricingHeading')}
        note={null}
        options={PRICINGS.map((value) => ({
          value,
          name: t(`poolManager.pricings.${pricingOfDraftType(value)}.name`),
          description: t(`poolManager.pricings.${pricingOfDraftType(value)}.description`),
          disabled: false,
        }))}
        selected={draftType}
        onSelect={setDraftType}
      />

      {/* Point budget (auction/budget only) and default price (budget only, never for point-buy seasons) */}
      {needsBudget && (
        <PoolBudgetFields
          budget={pointBudget}
          onBudgetChange={setPointBudget}
          budgetError={fieldErrors.budget ? fieldErrorText(fieldErrors.budget) : null}
          showsDefaultPrice={showsDefaultPrice}
          defaultPrice={defaultPrice}
          onDefaultPriceChange={setDefaultPrice}
          defaultPriceError={fieldErrors.defaultPrice ? fieldErrorText(fieldErrors.defaultPrice) : null}
        />
      )}

      <p className="text-sm text-poke-text-secondary">
        {needsBudget && fieldErrors.budget === null
          ? t('poolManager.summaryWithBudget', {
              order: t(`poolManager.orders.${order}.name`),
              pricing: t(`poolManager.pricings.${pricing}.name`),
              count: Number(pointBudget.value),
            })
          : t('poolManager.summary', {
              order: t(`poolManager.orders.${order}.name`),
              pricing: t(`poolManager.pricings.${pricing}.name`),
            })}
      </p>

      {error && (
        <p role="alert" className="text-sm text-poke-danger">
          {error.kind === 'api' ? apiErrorText(error.error) : t('poolManager.createFailed')}
        </p>
      )}

      <Button variant="primary" onClick={handleCreate} loading={loading} disabled={!fieldErrors.valid}>
        {t('poolManager.create')}
      </Button>
    </Card>
  );
}

interface OptionGroupProps<T extends string> {
  /** Prefix of the heading and option ids (unique per form via `useId()`). */
  idBase: string;
  heading: string;
  /** A one-line note under the options (already translated), or null. */
  note: string | null;
  options: readonly { value: T; name: string; description: string; disabled: boolean }[];
  selected: T;
  onSelect: (value: T) => void;
}

/** One labelled step of the form: toggle cards, each named by its option and described by its line. */
function OptionGroup<T extends string>({ idBase, heading, note, options, selected, onSelect }: OptionGroupProps<T>) {
  const headingId = `${idBase}-heading`;
  const noteId = `${idBase}-note`;
  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2">
      <p id={headingId} className="block text-sm font-heading font-semibold text-poke-text-primary">
        {heading}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            aria-labelledby={`${idBase}-${option.value}-name`}
            // A disabled card is also described by the note that says why.
            aria-describedby={
              option.disabled && note ? `${idBase}-${option.value}-desc ${noteId}` : `${idBase}-${option.value}-desc`
            }
            disabled={option.disabled}
            onClick={() => onSelect(option.value)}
            className={`p-3 border rounded-poke-lg text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              selected === option.value
                ? 'border-poke-border-focus bg-poke-blue-light'
                : 'border-poke-border hover:border-poke-border-strong'
            }`}
          >
            <span id={`${idBase}-${option.value}-name`} className="block font-medium text-sm text-poke-text-primary">
              {option.name}
            </span>
            <span id={`${idBase}-${option.value}-desc`} className="block mt-1 text-xs text-poke-text-muted">
              {option.description}
            </span>
          </button>
        ))}
      </div>
      {note && (
        <p id={noteId} className="text-xs text-poke-text-secondary">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The point-budget and default-price inputs. Their ids come from `useId()`, so
 * the admin league page can mount several pool managers without duplicate ids
 * breaking the label and error wiring.
 */
export function PoolBudgetFields({
  budget,
  onBudgetChange,
  budgetError,
  showsDefaultPrice,
  defaultPrice,
  onDefaultPriceChange,
  defaultPriceError,
}: {
  budget: NumberFieldState;
  onBudgetChange: (field: NumberFieldState) => void;
  /** Already translated budget error, or null. */
  budgetError: string | null;
  showsDefaultPrice: boolean;
  defaultPrice: NumberFieldState;
  onDefaultPriceChange: (field: NumberFieldState) => void;
  /** Already translated default-price error, or null. */
  defaultPriceError: string | null;
}) {
  const t = useT(draftLegacyBoardMessages);
  const ids = poolFieldIds(useId());
  return (
    <div className="flex flex-wrap gap-4">
      <div>
        <label htmlFor={ids.budget} className="block text-sm font-heading font-semibold text-poke-text-primary mb-1">
          {t('poolManager.pointBudget')}
        </label>
        {/* onInput as well: a badInput change can leave `value` at '' and skip React's onChange. */}
        <input
          id={ids.budget}
          type="number"
          inputMode="numeric"
          min={1}
          max={LEGACY_POINTS_MAX}
          step={1}
          value={budget.value}
          onChange={(e) => onBudgetChange(readNumberField(e.currentTarget))}
          onInput={(e) => onBudgetChange(readNumberField(e.currentTarget))}
          aria-invalid={budgetError !== null || undefined}
          aria-describedby={budgetError ? ids.budgetError : undefined}
          className={`${INPUT_CLASS} ${budgetError ? 'border-poke-danger' : 'border-poke-border'}`}
        />
        {budgetError && (
          <p id={ids.budgetError} className="text-xs text-poke-danger-ink mt-1">
            {budgetError}
          </p>
        )}
      </div>
      {showsDefaultPrice && (
        <div>
          <label htmlFor={ids.price} className="block text-sm font-heading font-semibold text-poke-text-primary mb-1">
            {t('poolManager.defaultPrice')}
          </label>
          <input
            id={ids.price}
            type="number"
            inputMode="numeric"
            min={0}
            max={LEGACY_POINTS_MAX}
            step={1}
            value={defaultPrice.value}
            onChange={(e) => onDefaultPriceChange(readNumberField(e.currentTarget))}
            onInput={(e) => onDefaultPriceChange(readNumberField(e.currentTarget))}
            aria-invalid={defaultPriceError !== null || undefined}
            aria-describedby={defaultPriceError ? `${ids.priceHint} ${ids.priceError}` : ids.priceHint}
            className={`${INPUT_CLASS} ${defaultPriceError ? 'border-poke-danger' : 'border-poke-border'}`}
          />
          <p id={ids.priceHint} className="text-xs text-poke-text-muted mt-1">
            {t('poolManager.defaultPriceHint')}
          </p>
          {defaultPriceError && (
            <p id={ids.priceError} className="text-xs text-poke-danger-ink mt-1">
              {defaultPriceError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
