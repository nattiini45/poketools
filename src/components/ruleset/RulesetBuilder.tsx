'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { RulesetFormData, BaseFormat } from '@/types/ruleset';
import { getFormatName, type FormatDefaults } from '@/lib/pkmn/format-catalog';
import { isEmptyTeamConstraints } from '@/lib/pkmn/team-constraints';
import type { ApiResult } from '@/types/api';
import type { Ruleset } from '@/types/ruleset';
import FormatSelector from './FormatSelector';
import FormatChangeDialog from './FormatChangeDialog';
import ClauseToggleGrid from './ClauseToggleGrid';
import BanlistEditor from './BanlistEditor';
import TeamConstraintsEditor from './TeamConstraintsEditor';
import {
  EMPTY_RULESET_FORM,
  applyDefaults,
  defaultsToLists,
  formatSwitchImpact,
  isRuleless,
  keepLists,
  listsOf,
  toSavePayload,
  type FormatSwitchImpact,
} from './ruleset-form';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useDataLocale, useT } from '@/i18n/client';
import { errorsTournaments } from '@/i18n/messages/errors';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { useApiErrorText } from '@/i18n/use-api-error';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface RulesetBuilderProps {
  initialData?: RulesetFormData;
  rulesetId?: string; // If editing an existing ruleset
}

/** Wizard steps; labels come from `ruleset.builder.steps`. */
const STEPS = ['format', 'clauses', 'banlists', 'constraints', 'review'] as const;

/**
 * A save failure, kept as data so it re-renders in the current language:
 * the API's error body, a non-JSON server error, or a failure with no message.
 */
type SaveError =
  | { kind: 'api'; error: ApiErrorLike }
  | { kind: 'server'; status: number; statusText?: string }
  | { kind: 'failed' };

/** The blank (custom) format starts with nothing, so its defaults need no request. */
const BLANK_DEFAULTS: FormatDefaults = {
  name: 'Custom Format',
  gen: 9,
  tier: 'Custom',
  is_doubles: false,
  clauses: [],
  banned_pokemon: [],
  banned_moves: [],
  banned_items: [],
};

/** A base-format switch that waits for the admin's answer: keep, replace or cancel. */
interface PendingFormatChange {
  format: BaseFormat;
  impact: FormatSwitchImpact;
  defaults: FormatDefaults;
}

export default function RulesetBuilder({ initialData, rulesetId }: RulesetBuilderProps) {
  const router = useRouter();
  const t = useT(rulesetMessages);
  const dl = useDataLocale();
  const errorText = useApiErrorText(errorsTournaments);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<RulesetFormData>(initialData ?? EMPTY_RULESET_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  // The format whose defaults could not be loaded (the form was left untouched).
  const [defaultsFailure, setDefaultsFailure] = useState<BaseFormat | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(() => !rulesetId && isRuleless(initialData ?? EMPTY_RULESET_FORM));
  const [pendingChange, setPendingChange] = useState<PendingFormatChange | null>(null);
  const formatRequestId = useRef(0);
  const defaultsCache = useRef(new Map<string, FormatDefaults>());
  // Async answers compare against the form as it is when they arrive.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  /** Defaults of a format, cached per builder; `null` when they cannot be loaded. */
  const fetchDefaults = useCallback(async (format: BaseFormat): Promise<FormatDefaults | null> => {
    if (format === 'blank') return BLANK_DEFAULTS;
    const cached = defaultsCache.current.get(format);
    if (cached) return cached;
    try {
      const res = await fetch(`/api/pkmn/format-defaults?format=${encodeURIComponent(format)}`);
      const json = (await res.json()) as ApiResult<FormatDefaults>;
      if (!json.success) return null;
      defaultsCache.current.set(format, json.data);
      return json.data;
    } catch {
      return null;
    }
  }, []);

  /**
   * Fills a form that enforces nothing with `format`'s defaults. Applied only
   * if the form is still empty when the answer arrives.
   */
  const loadDefaultsIntoEmptyForm = useCallback(
    async (format: BaseFormat) => {
      const requestId = ++formatRequestId.current;
      setDefaultsFailure(null);
      setDefaultsLoading(true);
      const d = await fetchDefaults(format);
      if (requestId !== formatRequestId.current) return; // stale response
      setDefaultsLoading(false);
      if (!d) {
        setDefaultsFailure(format);
        return;
      }
      const latest = formRef.current;
      if (latest.base_format !== format || !isRuleless(latest)) return;
      setForm((prev) => applyDefaults(prev, format, d));
    },
    [fetchDefaults],
  );

  // A new ruleset starts from its base format's defaults instead of an empty rule set.
  useEffect(() => {
    const initial = formRef.current;
    if (!rulesetId && isRuleless(initial)) void loadDefaultsIntoEmptyForm(initial.base_format);
  }, [rulesetId, loadDefaultsIntoEmptyForm]);

  const handleFormatChange = async (format: BaseFormat) => {
    const current = formRef.current.base_format;
    if (format === current) return;
    // Increment request counter so any in-flight fetch is ignored
    const requestId = ++formatRequestId.current;
    setDefaultsFailure(null);
    setDefaultsLoading(false);
    setPendingChange(null);

    // The form stays as it is until the answer is in.
    const [target, currentDefaults] = await Promise.all([fetchDefaults(format), fetchDefaults(current)]);
    if (requestId !== formatRequestId.current) return; // stale response
    if (!target) {
      setDefaultsFailure(format);
      return;
    }
    const baseline = currentDefaults ? defaultsToLists(currentDefaults) : null;
    const impact = formatSwitchImpact(listsOf(formRef.current), baseline);
    if (impact.customised) {
      setPendingChange({ format, impact, defaults: target });
    } else {
      setForm((prev) => applyDefaults(prev, format, target));
    }
  };

  const retryDefaults = () => {
    if (defaultsFailure === null) return;
    if (defaultsFailure === formRef.current.base_format) void loadDefaultsIntoEmptyForm(defaultsFailure);
    else void handleFormatChange(defaultsFailure);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const url = rulesetId ? `/api/rulesets/${rulesetId}` : '/api/rulesets';
      const method = rulesetId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSavePayload(form, initialData?.team_constraints)),
      });

      if (!res.ok) {
        try {
          const json = (await res.json()) as ApiResult<Ruleset>;
          setError(!json.success ? { kind: 'api', error: toApiErrorLike(json) } : { kind: 'server', status: res.status });
        } catch {
          setError({ kind: 'server', status: res.status, statusText: res.statusText });
        }
        return;
      }

      const json = (await res.json()) as ApiResult<Ruleset>;
      if (json.success) {
        router.push('/admin/rulesets');
      } else {
        setError({ kind: 'api', error: toApiErrorLike(json) });
      }
    } catch (err) {
      setError(err instanceof Error ? { kind: 'api', error: toApiErrorLike(err) } : { kind: 'failed' });
    } finally {
      setSaving(false);
    }
  };

  const errorMessage = (e: SaveError): string => {
    if (e.kind === 'server') {
      return e.statusText
        ? t('builder.serverErrorText', { status: e.status, statusText: e.statusText })
        : t('builder.serverError', { status: e.status });
    }
    if (e.kind === 'api' && (e.error.error || e.error.code)) return errorText(e.error);
    return t('builder.saveFailed');
  };

  const pct = form.min_shared_type_pct;
  const constraints = form.team_constraints;
  const quotas = constraints?.type_quotas;
  const stage = constraints?.evolution_stage;
  const quotaRule = quotas
    ? quotas.source === 'player_core'
      ? t('review.typeQuotaCore', { min: quotas.min_per_type })
      : t('review.typeQuotaFixed', {
          min: quotas.min_per_type,
          types: (quotas.fixed_types ?? []).map((type) => localizeType(type, dl)).join(', '),
        })
    : null;
  const nfeRule =
    stage?.mode === 'nfe_only_plus_n_fe'
      ? stage.fully_evolved_tier_max
        ? t('review.nfeOnlyTier', { cap: stage.fully_evolved_cap ?? 0, tier: stage.fully_evolved_tier_max })
        : t('review.nfeOnly', { cap: stage.fully_evolved_cap ?? 0 })
      : null;

  // A form with a real base format but no clause, ban or addition enforces nothing beyond the generation.
  const emptyNotice =
    isRuleless(form) && !defaultsLoading && defaultsFailure === null ? (
      <Alert variant="warning" className="space-y-2">
        <p className="font-semibold">{t('builder.emptyNotice.title')}</p>
        <p>{t('builder.emptyNotice.body', { format: getFormatName(form.base_format) })}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadDefaultsIntoEmptyForm(form.base_format)}
        >
          {t('builder.emptyNotice.load', { format: getFormatName(form.base_format) })}
        </Button>
      </Alert>
    ) : null;

  return (
    <div className="max-w-2xl">
      {/* Step indicators */}
      <div className="flex gap-2 mb-6">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            className={`px-3 py-1.5 rounded-poke-md text-sm font-heading font-semibold transition-colors ${
              i === step
                ? 'bg-poke-accent text-poke-surface shadow-poke-sm'
                : 'bg-poke-muted text-poke-text-muted hover:bg-poke-elevated hover:text-poke-text-primary'
            }`}
          >
            {t(`builder.steps.${s}` as const)}
          </button>
        ))}
      </div>

      {error && <Alert variant="error" className="mb-4">{errorMessage(error)}</Alert>}

      {defaultsFailure !== null && (
        <Alert variant="error" className="mb-4 flex items-center justify-between gap-3">
          <span>{t('builder.defaultsFailed', { format: getFormatName(defaultsFailure) })}</span>
          <Button variant="secondary" size="sm" onClick={retryDefaults}>
            {t('builder.defaultsRetry')}
          </Button>
        </Alert>
      )}

      <FormatChangeDialog
        format={pendingChange?.format ?? null}
        impact={pendingChange?.impact ?? null}
        onKeep={() => {
          if (pendingChange) setForm((prev) => keepLists(prev, pendingChange.format));
          setPendingChange(null);
        }}
        onReplace={() => {
          if (pendingChange) setForm((prev) => applyDefaults(prev, pendingChange.format, pendingChange.defaults));
          setPendingChange(null);
        }}
        onCancel={() => setPendingChange(null)}
      />

      {/* Step 0: Format & Name */}
      {step === 0 && (
        <div className="space-y-4">
          <Input
            label={t('builder.name')}
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder={t('builder.namePlaceholder')}
          />
          <FormatSelector value={form.base_format} onChange={(format) => void handleFormatChange(format)} />
          {emptyNotice}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_doubles}
              onChange={e => setForm(prev => ({ ...prev, is_doubles: e.target.checked }))}
              className="rounded accent-poke-accent"
            />
            <span className="text-sm text-poke-text-primary">{t('builder.doublesToggle')}</span>
          </label>
          <div>
            <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-1.5">
              {t('builder.minSharedType')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={form.min_shared_type_pct}
                onChange={e => setForm(prev => ({ ...prev, min_shared_type_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                className="w-20 border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
              />
              <span className="text-sm text-poke-text-secondary">%</span>
              <span className="text-xs text-poke-text-muted">
                {pct === 0
                  ? t('builder.sharedTypeOff')
                  : pct === 100
                    ? t('builder.sharedTypeMonotype')
                    : t('builder.sharedTypeExample', {
                        six: Math.round((6 * pct) / 100),
                        four: Math.round((4 * pct) / 100),
                        three: Math.round((3 * pct) / 100),
                      })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Clauses */}
      {step === 1 && (
        <ClauseToggleGrid
          selected={form.clauses}
          onChange={clauses => setForm(prev => ({ ...prev, clauses }))}
        />
      )}

      {/* Step 2: Banlists */}
      {step === 2 && (
        <div className="space-y-6">
          <BanlistEditor
            label={t('builder.bannedPokemon')}
            searchType="species"
            items={form.banned_pokemon}
            onChange={banned_pokemon => setForm(prev => ({ ...prev, banned_pokemon }))}
          />
          <BanlistEditor
            label={t('builder.bannedMoves')}
            searchType="moves"
            items={form.banned_moves}
            onChange={banned_moves => setForm(prev => ({ ...prev, banned_moves }))}
          />
          <BanlistEditor
            label={t('builder.bannedItems')}
            searchType="items"
            items={form.banned_items}
            onChange={banned_items => setForm(prev => ({ ...prev, banned_items }))}
          />
          <BanlistEditor
            label={t('builder.bannedAbilities')}
            searchType="abilities"
            items={form.banned_abilities}
            onChange={banned_abilities => setForm(prev => ({ ...prev, banned_abilities }))}
          />
          <BanlistEditor
            label={t('builder.addedPokemon')}
            searchType="species"
            items={form.added_pokemon}
            onChange={added_pokemon => setForm(prev => ({ ...prev, added_pokemon }))}
          />
          <div>
            <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-1.5">{t('builder.customRules')}</label>
            <textarea
              value={form.custom_rules_string}
              onChange={e => setForm(prev => ({ ...prev, custom_rules_string: e.target.value }))}
              className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
              rows={3}
              placeholder={t('builder.customRulesPlaceholder')}
            />
          </div>
        </div>
      )}

      {/* Step 3: Team Constraints */}
      {step === 3 && (
        <TeamConstraintsEditor
          value={form.team_constraints}
          onChange={(team_constraints) => setForm((prev) => ({ ...prev, team_constraints }))}
        />
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="space-y-4 text-sm text-poke-text-primary">
          {emptyNotice}
          <div>
            <span className="font-heading font-semibold">{t('review.name')}</span> {form.name || t('review.unnamed')}
          </div>
          <div>
            <span className="font-heading font-semibold">{t('review.baseFormat')}</span> {form.base_format}
            {form.is_doubles && ` ${t('review.doubles')}`}
          </div>
          <div>
            <span className="font-heading font-semibold">{t('review.clauses', { count: form.clauses.length })}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {form.clauses.map(c => (
                <Badge key={c} variant="blue">{c}</Badge>
              ))}
            </div>
          </div>
          {form.banned_pokemon.length > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.bannedPokemon', { count: form.banned_pokemon.length })}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {form.banned_pokemon.map(p => (
                  <Badge key={p} variant="red">{localizeSpecies(p, dl)}</Badge>
                ))}
              </div>
            </div>
          )}
          {form.banned_moves.length > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.bannedMoves', { count: form.banned_moves.length })}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {form.banned_moves.map(m => (
                  <Badge key={m} variant="red">{localizeMove(m, dl)}</Badge>
                ))}
              </div>
            </div>
          )}
          {form.banned_items.length > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.bannedItems', { count: form.banned_items.length })}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {form.banned_items.map(i => (
                  <Badge key={i} variant="red">{localizeItem(i, dl)}</Badge>
                ))}
              </div>
            </div>
          )}
          {form.banned_abilities.length > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.bannedAbilities', { count: form.banned_abilities.length })}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {form.banned_abilities.map(a => (
                  <Badge key={a} variant="red">{localizeAbility(a, dl)}</Badge>
                ))}
              </div>
            </div>
          )}
          {form.added_pokemon.length > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.addedPokemon', { count: form.added_pokemon.length })}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {form.added_pokemon.map(p => (
                  <Badge key={p} variant="green">{localizeSpecies(p, dl)}</Badge>
                ))}
              </div>
            </div>
          )}
          {form.min_shared_type_pct > 0 && (
            <div>
              <span className="font-heading font-semibold">{t('review.sharedType')}</span>{' '}
              {t('detail.sharedTypeRule', { percent: pct })}
            </div>
          )}
          {constraints && !isEmptyTeamConstraints(constraints) && (
            <div>
              <span className="font-heading font-semibold">{t('review.teamConstraints')}</span>
              <ul className="mt-1 ml-4 list-disc text-xs text-poke-text-secondary space-y-0.5">
                {quotas && quotaRule && (
                  <li>{quotas.allow_multi_count ? t('review.multiCount', { rule: quotaRule }) : quotaRule}</li>
                )}
                {constraints.tera_match && constraints.tera_match !== 'none' && (
                  <li>{t(`review.teraMatch.${constraints.tera_match}` as const)}</li>
                )}
                {stage?.mode === 'nfe_only_plus_n_fe' && nfeRule && (
                  <li>{stage.legendaries_allowed === false ? t('review.noLegendaries', { rule: nfeRule }) : nfeRule}</li>
                )}
                {stage?.mode === 'unrestricted' && stage.legendaries_allowed === false && (
                  <li>{t('review.legendariesBanned')}</li>
                )}
                {constraints.eviolite_tier_cap && (
                  <li>
                    {t('review.evioliteCap', {
                      item: localizeItem('Eviolite', dl),
                      tier: constraints.eviolite_tier_cap,
                    })}
                  </li>
                )}
              </ul>
            </div>
          )}
          {form.custom_rules_string && (
            <div>
              <span className="font-heading font-semibold">{t('review.customRules')}</span>
              <pre className="mt-1 p-2 bg-poke-muted rounded-poke-md text-xs">{form.custom_rules_string}</pre>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6 pt-4 border-t border-poke-border">
        <Button
          variant="ghost"
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          {t('builder.previous')}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="secondary" onClick={() => setStep(s => s + 1)}>
            {t('builder.next')}
          </Button>
        ) : (
          <Button
            variant="success"
            onClick={handleSave}
            loading={saving}
            disabled={!form.name}
          >
            {rulesetId ? t('builder.update') : t('builder.create')}
          </Button>
        )}
      </div>
    </div>
  );
}
