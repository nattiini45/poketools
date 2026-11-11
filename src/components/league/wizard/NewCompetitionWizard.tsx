'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import Select from '@/components/ui/Select';
import SkewChip from '@/components/ui/SkewChip';
import Textarea from '@/components/ui/Textarea';
import CloneSourcePicker from '@/components/league/CloneSourcePicker';
import { LeagueDateFields, LeagueRulesetField, LeagueTypeField } from '@/components/league/league-form-fields';
import RulesetSelect from '@/components/ruleset/RulesetSelect';
import { useFormatter, useT } from '@/i18n/client';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { languageMessages } from '@/i18n/messages/language';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { cloneFormDefaults, isCloneSourceFormat, type CloneSourceOption } from '@/lib/league-admin/clone-source';
import {
  WIZARD_STEPS,
  buildWizardRequest,
  detailsProblem,
  startsFromFormat,
  wizardCreatedHref,
  type WizardDetails,
  type WizardExample,
  type WizardFormat,
  type WizardStart,
  type WizardStep,
} from '@/lib/league-admin/wizard';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { useSubmitPhase } from '@/lib/ui/use-submit-phase';
import { cn } from '@/lib/utils/cn';
import { getRouteThemeOptions } from '@/lib/worlds/route-theme-options';
import type { ApiResult } from '@/types/api';
import type { RouteThemeId, Season, SeasonFormatType } from '@/types/season';

interface NewCompetitionWizardProps {
  examples: readonly WizardExample[];
  /** Published formats the viewer may attach. */
  formats: readonly WizardFormat[];
  rulesets: readonly RulesetOption[];
  /** Leagues the viewer may copy. */
  sources: CloneSourceOption[];
  /** Only site admins may copy the league admins. */
  isSiteAdmin: boolean;
  /** The starting point a link picked ("Create a league from this"). */
  initialStart: WizardStart | null;
}

/** The league types a blank league can take; a custom league is made from a format, in the wizard's other starts. */
const FORMAT_TYPES: readonly SeasonFormatType[] = ['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom'];
const ROUTE_THEME_OPTIONS = getRouteThemeOptions();
/** New leagues default to German content (i18n-core §6.1: existing leagues are German). */
const DEFAULT_LEAGUE_LANGUAGE: Locale = 'de';

const EXAMPLE_ICONS: Record<string, ItemIconId> = {
  'classic-league': 'town-map',
  cup: 'kings-rock',
  'swiss-top-cut': 'scope-lens',
  wichtelcup: 'poke-doll',
};

const startKey = (start: WizardStart): string => ('id' in start ? `${start.kind}:${start.id}` : start.kind);

function StartOption({
  start,
  current,
  onPick,
  icon,
  title,
  selectedLabel,
  children,
}: {
  start: WizardStart;
  current: WizardStart | null;
  onPick: (start: WizardStart) => void;
  icon: ItemIconId;
  title: string;
  selectedLabel: string;
  children?: ReactNode;
}) {
  const checked = current !== null && startKey(current) === startKey(start);
  return (
    <label
      className={cn(
        'relative flex cursor-pointer gap-3 rounded-poke-lg border p-4 transition-[background-color,border-color] duration-80 ease-out',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)] has-[:focus-visible]:outline-solid',
        checked ? 'border-accent-ink bg-selected' : 'border-hairline bg-surface hover:border-hairline-strong hover:bg-hover',
      )}
    >
      <input type="radio" name="wizard-start" value={startKey(start)} checked={checked} onChange={() => onPick(start)} className="sr-only" />
      <ItemIcon item={icon} size={48} className="self-start" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-heading text-lg leading-6 break-words text-fg">{title}</span>
          {checked && (
            <span aria-hidden="true">
              <SkewChip tone="tier-1">{selectedLabel}</SkewChip>
            </span>
          )}
        </span>
        {children}
      </span>
    </label>
  );
}

function RailRow({ icon, title, hint }: { icon: ItemIconId; title: string; hint?: string }) {
  return (
    <li className="flex gap-3">
      <ItemIcon item={icon} size={24} className="self-start" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-[550] break-words text-fg">{title}</span>
        {hint && <span className="text-caption break-words text-fg-muted">{hint}</span>}
      </span>
    </li>
  );
}

/**
 * The new-competition wizard for a league (`/admin/leagues/new`): starting point, details, review. One request creates
 * the league (`POST /api/seasons`): from an example or a published format in one transaction, as a copy of a league,
 * or blank. The rail on the side says what the chosen start creates.
 */
export default function NewCompetitionWizard({ examples, formats, rulesets, sources: allSources, isSiteAdmin, initialStart }: NewCompetitionWizardProps) {
  const t = useT(leagueAdminMessages);
  const tLang = useT(languageMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const fmt = useFormatter();
  const router = useRouter();

  // A custom league gets its phases from a format, so it is never a source to copy (the server refuses it as well).
  const sources = useMemo(() => allSources.filter((source) => isCloneSourceFormat(source.format_type)), [allSources]);

  const [step, setStep] = useState<WizardStep>('start');
  const [start, setStart] = useState<WizardStart | null>(initialStart);
  const [details, setDetails] = useState<WizardDetails>({
    name: '',
    description: '',
    formatType: 'singles',
    rulesetId: '',
    startDate: '',
    endDate: '',
    routeTheme: 'auto',
    language: DEFAULT_LEAGUE_LANGUAGE,
  });
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [copyRoster, setCopyRoster] = useState(false);
  const [copyAdmins, setCopyAdmins] = useState(false);
  /** The step's own refusal: nothing picked, or what the details still miss. */
  const [problem, setProblem] = useState<'pick' | NonNullable<ReturnType<typeof detailsProblem>> | null>(null);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  // A created league navigates to its admin page: the button stays disabled until the page changes.
  const submit = useSubmitPhase();

  const example = start?.kind === 'preset' ? (examples.find((entry) => entry.id === start.id) ?? null) : null;
  const format = start?.kind === 'format' ? (formats.find((entry) => entry.id === start.id) ?? null) : null;
  const source = start?.kind === 'copy' && sourceId ? (sources.find((entry) => entry.id === sourceId) ?? null) : null;
  const fromFormat = start !== null && startsFromFormat(start);
  const formatType: SeasonFormatType = fromFormat ? 'custom' : details.formatType;
  const isPointBuy = isEvolutionPointBuy(formatType);
  const stepIndex = WIZARD_STEPS.indexOf(step);

  const formatOptions = useMemo(() => FORMAT_TYPES.map((value) => ({ value, label: t(`form.leagueTypeOption.${value}`) })), [t]);
  const themeOptions = useMemo(() => ROUTE_THEME_OPTIONS.map((o) => (o.value === 'auto' ? { ...o, label: t('theme.auto') } : o)), [t]);
  const languageOptions = useMemo(() => LOCALES.map((value) => ({ value, label: tLang(`names.${value}`) })), [tLang]);

  // Each step starts at its heading, for keyboard and screen-reader users; the first render leaves focus alone.
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const set = (patch: Partial<WizardDetails>) => {
    setDetails((current) => ({ ...current, ...patch }));
    setProblem(null);
  };

  function pick(next: WizardStart) {
    setStart(next);
    setProblem(null);
    setError(null);
  }

  /** A new source starts with both options off and brings the settings a new league usually repeats. */
  function changeSource(next: string | null) {
    setSourceId(next);
    setCopyRoster(false);
    setCopyAdmins(false);
    setProblem(null);
    const option = next ? sources.find((entry) => entry.id === next) : undefined;
    if (!option) return;
    const defaults = cloneFormDefaults(option);
    setDetails((current) => ({
      ...current,
      formatType: defaults.format_type ?? current.formatType,
      rulesetId: defaults.ruleset_id ?? '',
      routeTheme: defaults.route_theme ?? current.routeTheme,
      language: defaults.language ?? current.language,
      description: defaults.description ?? current.description,
    }));
  }

  function goTo(next: WizardStep) {
    setProblem(null);
    setError(null);
    setStep(next);
  }

  function next() {
    if (step === 'start') {
      if (start === null) return setProblem('pick');
      return goTo('details');
    }
    if (step === 'details' && start !== null) {
      const found = detailsProblem(start, details, example, sourceId);
      if (found) return setProblem(found);
      return goTo('review');
    }
  }

  async function create() {
    if (start === null) return;
    await submit.run(async () => {
      setError(null);
      try {
        const body = buildWizardRequest({
          start,
          details,
          formats,
          clone: source ? { sourceId: source.id, copyRoster, copyAdmins } : null,
          isSiteAdmin,
        });
        const res = await fetch('/api/seasons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result: ApiResult<Season | { season: Season }> = await res.json();
        if (!result.success) {
          setError(result);
          return 'failed';
        }
        const season = 'season' in result.data ? result.data.season : result.data;
        router.push(wizardCreatedHref(season.id, start, formatType));
        return 'done';
      } catch (err) {
        setError(toApiErrorLike(err));
        return 'failed';
      }
    });
  }

  const selectedLabel = t('wizard.start.selected');
  const startLabel =
    example?.title ??
    (format ? t('wizard.rail.formatAttached', { name: format.name, n: format.version }) : null) ??
    (start?.kind === 'copy' ? (source ? t('wizard.review.copyOf', { name: source.name }) : t('wizard.start.copy')) : null) ??
    (start?.kind === 'blank' ? t('wizard.start.blank') : '');
  const pickedRuleset = rulesets.find((ruleset) => ruleset.id === details.rulesetId) ?? null;
  const dates =
    details.startDate && details.endDate
      ? t('wizard.review.datesRange', { start: fmt.calendarDate(details.startDate), end: fmt.calendarDate(details.endDate) })
      : details.startDate
        ? t('wizard.review.datesFrom', { start: fmt.calendarDate(details.startDate) })
        : details.endDate
          ? t('wizard.review.datesUntil', { end: fmt.calendarDate(details.endDate) })
          : t('wizard.review.datesNone');

  const reviewRows: { label: string; value: string; step: WizardStep }[] = [
    {
      label: t('wizard.review.startingPoint'),
      value: [startLabel, source && copyRoster ? t('wizard.review.copyRoster') : '', source && copyAdmins ? t('wizard.review.copyAdmins') : '']
        .filter((part) => part !== '')
        .join(', '),
      step: 'start',
    },
    { label: t('wizard.review.name'), value: details.name.trim(), step: 'details' },
    { label: t('wizard.review.leagueType'), value: t(`form.leagueTypeOption.${formatType}`), step: fromFormat ? 'start' : 'details' },
    {
      label: t('wizard.review.ruleset'),
      value: isPointBuy ? t('wizard.review.rulesetAuto') : (pickedRuleset?.name ?? t('wizard.review.rulesetNone')),
      step: 'details',
    },
    { label: t('wizard.review.dates'), value: dates, step: 'details' },
    { label: t('wizard.review.language'), value: tLang(`names.${details.language}`), step: 'details' },
    { label: t('wizard.review.theme'), value: themeOptions.find((option) => option.value === details.routeTheme)?.label ?? details.routeTheme, step: 'details' },
    { label: t('wizard.review.description'), value: details.description.trim() || t('wizard.review.descriptionNone'), step: 'details' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <ol aria-label={t('wizard.stepsLabel')} className="flex flex-wrap gap-x-6 gap-y-2">
        {WIZARD_STEPS.map((id, index) => {
          const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
          return (
            <li key={id} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-2 text-sm">
              <SkewChip tone={state === 'current' ? 'tier-1' : state === 'done' ? 'accent' : 'neutral'}>{index + 1}</SkewChip>
              <span className={state === 'current' ? 'font-[550] text-fg' : 'text-fg-muted'}>{t(`wizard.steps.${id}`)}</span>
              {state === 'done' && <span className="sr-only">({t('wizard.stepDone')})</span>}
            </li>
          );
        })}
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="wizard-step-heading" className="flex min-w-0 flex-col gap-5">
          <h2 id="wizard-step-heading" ref={heading} tabIndex={-1} className="font-heading text-xl text-fg outline-none">
            {t(`wizard.steps.${step}`)}
          </h2>

          {/* A missing name, date order or ruleset is said at its field; these two have no field of their own. */}
          {problem === 'pick' && <Alert variant="error">{t('wizard.start.pickFirst')}</Alert>}
          {problem === 'source' && <Alert variant="error">{t('wizard.problems.source')}</Alert>}

          {step === 'start' && (
            <fieldset className="flex min-w-0 flex-col gap-6">
              <legend className="sr-only">{t('wizard.start.legend')}</legend>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-[550] text-fg">{t('wizard.start.examples')}</h3>
                  <p className="text-sm text-fg-muted">{t('wizard.start.examplesHint')}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {examples.map((entry) => (
                    <StartOption
                      key={entry.id}
                      start={{ kind: 'preset', id: entry.id }}
                      current={start}
                      onPick={pick}
                      icon={EXAMPLE_ICONS[entry.id] ?? 'poke-ball'}
                      title={entry.title}
                      selectedLabel={selectedLabel}
                    >
                      <span className="text-sm break-words text-fg-muted">{entry.summary ?? entry.overview}</span>
                      <span className="text-caption text-fg-muted">{t('wizard.start.stages', { count: entry.stages.length })}</span>
                    </StartOption>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-[550] text-fg">{t('wizard.start.formats')}</h3>
                  <p className="text-sm text-fg-muted">{formats.length > 0 ? t('wizard.start.formatsHint') : t('wizard.start.formatsEmpty')}</p>
                </div>
                {formats.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {formats.map((entry) => (
                      <StartOption
                        key={entry.id}
                        start={{ kind: 'format', id: entry.id }}
                        current={start}
                        onPick={pick}
                        icon="up-grade"
                        title={entry.name}
                        selectedLabel={selectedLabel}
                      >
                        <span className="text-caption text-fg-muted">
                          {[t('wizard.start.formatVersion', { n: entry.version }), !entry.mine && entry.ownerName ? t('wizard.start.formatBy', { name: entry.ownerName }) : '']
                            .filter((part) => part !== '')
                            .join(' · ')}
                        </span>
                      </StartOption>
                    ))}
                  </div>
                ) : (
                  <Link href="/admin/formats" className="inline-flex min-h-11 items-center self-start text-sm font-medium text-accent-ink hover:underline sm:min-h-0">
                    {t('wizard.start.formatsLink')}
                  </Link>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-[550] text-fg">{t('wizard.start.otherStarts')}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StartOption start={{ kind: 'blank' }} current={start} onPick={pick} icon="premier-ball" title={t('wizard.start.blank')} selectedLabel={selectedLabel}>
                    <span className="text-sm text-fg-muted">{t('wizard.start.blankHint')}</span>
                  </StartOption>
                  {sources.length > 0 ? (
                    <StartOption start={{ kind: 'copy' }} current={start} onPick={pick} icon="exp-share" title={t('wizard.start.copy')} selectedLabel={selectedLabel}>
                      <span className="text-sm text-fg-muted">{t('wizard.start.copyHint')}</span>
                    </StartOption>
                  ) : (
                    <p className="self-center text-sm text-fg-muted">{t('wizard.start.copyNone')}</p>
                  )}
                </div>
              </div>
            </fieldset>
          )}

          {step === 'details' && start !== null && (
            <div className="flex max-w-xl flex-col gap-4">
              {start.kind === 'copy' && (
                <CloneSourcePicker
                  sources={sources}
                  rulesets={rulesets}
                  isSiteAdmin={isSiteAdmin}
                  sourceId={source?.id ?? null}
                  copyRoster={copyRoster}
                  copyAdmins={copyAdmins}
                  onSourceChange={changeSource}
                  onCopyRosterChange={setCopyRoster}
                  onCopyAdminsChange={setCopyAdmins}
                />
              )}

              <Input
                label={t('form.name')}
                type="text"
                value={details.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                placeholder={t('form.namePlaceholder')}
                error={problem === 'name' ? t('wizard.problems.name') : undefined}
              />

              <Textarea
                label={t('form.description')}
                value={details.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder={t('form.descriptionPlaceholder')}
                rows={3}
              />

              {!fromFormat && (
                <LeagueTypeField
                  id="league-type"
                  label={t('form.leagueType')}
                  value={details.formatType}
                  onChange={(value) => set({ formatType: value })}
                  options={formatOptions}
                  note={isPointBuy ? { id: 'league-battle-format', text: t('form.battleFormatFixed') } : null}
                />
              )}

              {fromFormat ? (
                <div className="flex flex-col gap-1.5">
                  <RulesetSelect
                    id="league-ruleset"
                    label={example?.needsLeagueRuleset ? t('wizard.details.rulesetRequired') : t('form.ruleset')}
                    value={details.rulesetId}
                    onChange={(value) => set({ rulesetId: value })}
                    options={rulesets}
                    placeholder={example?.needsLeagueRuleset ? t('wizard.details.selectRuleset') : t('form.noRuleset')}
                    required={example?.needsLeagueRuleset === true}
                    aria-describedby={problem === 'ruleset' ? 'league-ruleset-problem league-ruleset-hint' : 'league-ruleset-hint'}
                    aria-invalid={problem === 'ruleset' ? true : undefined}
                  />
                  {problem === 'ruleset' && (
                    <p id="league-ruleset-problem" role="alert" className="text-sm text-loss">
                      {t('wizard.problems.ruleset')}
                    </p>
                  )}
                  <p id="league-ruleset-hint" className="text-caption text-fg-muted">
                    {example?.needsLeagueRuleset ? t('wizard.details.rulesetRequiredHint') : t('wizard.details.rulesetFormatHint')}
                  </p>
                </div>
              ) : (
                <LeagueRulesetField isPointBuy={isPointBuy} rulesets={rulesets} value={details.rulesetId} onChange={(value) => set({ rulesetId: value })} />
              )}

              <LeagueDateFields
                start={details.startDate}
                end={details.endDate}
                onStart={(value) => set({ startDate: value })}
                onEnd={(value) => set({ endDate: value })}
                error={problem === 'dates' ? t('wizard.problems.dates') : undefined}
              />

              <Select
                label={t('form.worldTheme')}
                value={details.routeTheme}
                onChange={(e) => set({ routeTheme: e.target.value as RouteThemeId })}
                options={themeOptions}
              />

              <div className="flex flex-col gap-1.5">
                <Select
                  id="league-content-language"
                  label={t('form.contentLanguage')}
                  value={details.language}
                  onChange={(e) => {
                    if (isLocale(e.target.value)) set({ language: e.target.value });
                  }}
                  options={languageOptions}
                  aria-describedby="league-content-language-hint"
                />
                <p id="league-content-language-hint" className="text-caption text-fg-muted">
                  {t('form.contentLanguageHint')}
                </p>
              </div>
            </div>
          )}

          {step === 'review' && start !== null && (
            <div className="flex flex-col gap-4">
              <p className="max-w-prose text-sm text-fg-muted">{fromFormat ? t('wizard.review.intro') : t('wizard.review.introPlain')}</p>
              {error && <Alert variant="error">{error.error || error.code ? errorText(error) : t('wizard.review.failed')}</Alert>}
              <Card padding="none">
                <dl className="divide-y divide-hairline">
                  {reviewRows.map((row) => (
                    <div key={row.label} className="flex flex-col gap-x-4 px-5 py-3 sm:flex-row sm:items-baseline">
                      <dt className="shrink-0 text-sm text-fg-muted sm:w-40">{row.label}</dt>
                      <dd className="flex min-w-0 flex-1 items-baseline gap-4 text-sm text-fg">
                        <span className="min-w-0 flex-1 break-words">{row.value}</span>
                        <button
                          type="button"
                          onClick={() => goTo(row.step)}
                          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center font-medium text-accent-ink hover:underline sm:min-h-0"
                        >
                          {t('wizard.review.edit')}
                          <span className="sr-only">: {row.label}</span>
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          )}
        </section>

        <aside aria-labelledby="wizard-rail-heading" className="lg:sticky lg:top-20">
          <Card className="flex flex-col gap-4">
            <h2 id="wizard-rail-heading" className="font-heading text-lg text-fg">
              {t('wizard.rail.heading')}
            </h2>
            {start === null ? (
              <p className="text-sm text-fg-muted">{t('wizard.rail.empty')}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-3">
                  <RailRow
                    icon="poke-ball"
                    title={details.name.trim() || (fromFormat ? t('wizard.rail.leagueCustom') : t('wizard.rail.league'))}
                    hint={
                      start.kind === 'blank'
                        ? t('wizard.rail.blankHint')
                        : start.kind === 'copy'
                          ? t('wizard.rail.copyHint')
                          : step === 'start'
                            ? t('wizard.rail.leagueHint')
                            : details.name.trim()
                              ? t('wizard.rail.leagueCustom')
                              : undefined
                    }
                  />
                  {example && (
                    <>
                      <RailRow icon="up-grade" title={t('wizard.rail.formatCopy', { name: example.title })} hint={t('wizard.rail.formatCopyHint')} />
                      {example.stages.map((stage) => (
                        <RailRow key={stage.key} icon="vs-seeker" title={t('wizard.rail.stage', { name: stage.name })} hint={stage.detail} />
                      ))}
                      {example.presetRulesetCount > 0 && (
                        <RailRow icon="ability-shield" title={t('wizard.rail.rulesets', { count: example.presetRulesetCount })} hint={t('wizard.rail.rulesetsHint')} />
                      )}
                    </>
                  )}
                  {format && (
                    <RailRow icon="up-grade" title={t('wizard.rail.formatAttached', { name: format.name, n: format.version })} hint={t('wizard.rail.formatAttachedHint')} />
                  )}
                </ul>
                <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                  <h3 className="text-caption text-fg-muted">{t('wizard.rail.after')}</h3>
                  <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-fg">
                    {start.kind === 'blank' && <li>{t('wizard.rail.afterPhases')}</li>}
                    <li>{t('wizard.rail.afterPlayers')}</li>
                    {fromFormat && <li>{t('wizard.rail.afterReadiness')}</li>}
                    <li>{t('wizard.rail.afterStart')}</li>
                  </ol>
                </div>
              </>
            )}
          </Card>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-hairline bg-page px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className="text-sm text-fg-muted max-sm:sr-only" aria-live="polite">
          {t('wizard.stepOf', { n: stepIndex + 1, total: WIZARD_STEPS.length })}
        </p>
        <span className="flex-1" />
        <Button asChild variant="ghost">
          <Link href="/admin/leagues">{t('wizard.cancel')}</Link>
        </Button>
        {stepIndex > 0 && (
          <Button type="button" variant="secondary" onClick={() => goTo(WIZARD_STEPS[stepIndex - 1])} disabled={!submit.canSubmit}>
            {t('wizard.back')}
          </Button>
        )}
        {step === 'review' ? (
          <Button type="button" variant="primary" onClick={create} loading={!submit.canSubmit}>
            {t('wizard.create')}
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={next}>
            {t('wizard.next')}
          </Button>
        )}
      </div>
    </div>
  );
}
