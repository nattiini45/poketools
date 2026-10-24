'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import type {
  AdminMatchFilterOptions,
  AdminMatchLeagueOption,
  AdminMatchPhaseOption,
  AdminMatchRoundOption,
  AdminMatchStandaloneOption,
} from '@/lib/supabase/queries/matches';
import {
  ADMIN_MATCH_AUTO_CONFIRM_SOON_HOURS,
  ADMIN_MATCH_BRACKET_TYPES,
  ADMIN_MATCH_BEST_OF_CHOICES,
  ADMIN_MATCH_DATE_FIELDS,
  ADMIN_MATCH_DATE_RANGES,
  ADMIN_MATCH_FORMAT_TYPES,
  ADMIN_MATCH_PRESETS,
  ADMIN_MATCH_SEARCH_MAX_LENGTH,
  ADMIN_MATCH_SORTS,
  ADMIN_MATCH_STALE_IN_PROGRESS_DAYS,
  ADMIN_MATCH_STATUSES,
  STANDALONE_LEAGUE,
  activeMatchListFilters,
  clearMatchListFilters,
  type AdminMatchDateField,
  type AdminMatchDateRange,
  type AdminMatchPreset,
  type MatchListFilterKey,
  type MatchListUrlState,
} from '@/lib/admin/match-list';
import {
  PLAYER_SEARCH_MIN_QUERY,
  PLAYER_SEARCH_NETWORK_ERROR,
  parsePlayerSearch,
  playerSearchUrl,
  searchTruncation,
  type PlayerSearchHit,
  type PlayerSearchScope,
} from '@/lib/players/player-search';
import { matchPlayerSearchScope, rulesetChoices } from '@/components/admin/match-list-view';
import Alert from '@/components/ui/Alert';
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { useApiErrorText } from '@/i18n/use-api-error';
import { type ApiErrorLike } from '@/i18n/api-errors';
import { shellMessages } from '@/i18n/messages/shell';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsAdmin } from '@/i18n/messages/errors';

/** Status tabs: '' = all, then each match status (its label is `admin.matches.status.<value>`). */
const STATUS_TABS: readonly MatchListUrlState['status'][] = ['', ...ADMIN_MATCH_STATUSES];

/** The date fields whose column can be empty ("no date set" only makes sense for them). */
const NULLABLE_DATE_FIELDS: readonly AdminMatchDateField[] = ['scheduled', 'played'];

/** Filters that live inside the "More filters" panel (the count on its button). `player2` is part of the player chip. */
const PANEL_FILTER_KEYS: readonly MatchListFilterKey[] = [
  'date',
  'format',
  'bracket',
  'bestOf',
  'ruleset',
  'player',
  'replay',
  'edited',
  'notes',
  'noGames',
  'showTest',
  'showArchived',
];

const SELECT_CLASSES =
  'border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full';
const FIELD_LABEL_CLASSES = 'block text-xs font-heading font-semibold text-poke-text-secondary mb-1';
const FIELDSET_CLASSES = 'min-w-0 space-y-3 rounded-poke-md border border-poke-border p-3';
const LEGEND_CLASSES = 'px-1 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted';
const TOGGLE_BASE_CLASSES =
  'px-2.5 py-1 text-xs font-heading font-medium rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const TOGGLE_ON_CLASSES = 'border-poke-accent bg-poke-accent-light text-poke-accent';
const TOGGLE_OFF_CLASSES = 'border-poke-border text-poke-text-secondary hover:border-poke-border-focus hover:text-poke-text-primary';

/** A pressed / unpressed pill button (quick filters, date ranges). */
function ToggleButton({
  pressed,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`${TOGGLE_BASE_CLASSES} ${pressed ? TOGGLE_ON_CLASSES : TOGGLE_OFF_CLASSES}`}
    >
      {children}
    </button>
  );
}

function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-poke-text-primary cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-poke-border bg-poke-surface text-poke-primary focus:ring-poke-primary/50"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Server-side player search for one picker of the filter bar. `usePlayerSearch` of the roster
 * only supports a league scope; the matches page borrows whichever league or tournament the
 * admin administers (`matchPlayerSearchScope`). Hits it has seen go to `remember`, so a picked id
 * can be shown by name; `excludeId` greys out the player already chosen in the other picker.
 */
function usePlayerPicker(
  scope: PlayerSearchScope | null,
  excludeId: string,
  remember: (hits: readonly PlayerSearchHit[]) => void,
) {
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [more, setMore] = useState<{ shown: number; total: number } | null>(null);

  const transformResults = useCallback(
    (json: unknown): ComboboxOption[] => {
      const outcome = parsePlayerSearch(json);
      if (!outcome.ok) {
        setError(outcome.error);
        setMore(null);
        return [];
      }
      setError(null);
      setMore(searchTruncation(outcome));
      remember(outcome.hits);
      return outcome.hits.map((hit) => ({ label: hit.name, value: hit.id, disabled: hit.id === excludeId }));
    },
    [excludeId, remember],
  );

  const onFetchError = useCallback(() => {
    setError(PLAYER_SEARCH_NETWORK_ERROR);
    setMore(null);
  }, []);

  return { fetchUrl: scope ? playerSearchUrl(scope) : '', transformResults, onFetchError, error, more };
}

export interface AdminMatchFiltersProps {
  /** The list's URL state; the bar renders it and never keeps a copy. */
  url: MatchListUrlState;
  update: (patch: Partial<MatchListUrlState>) => void;
  /** The search box's local text (sent to the URL by the list after a pause). */
  searchInput: string;
  onSearchChange: (value: string) => void;
  options: AdminMatchFilterOptions | null;
  /** The filter options could not be loaded (an unknown deep-linked id then shows as the id). */
  optionsFailed: boolean;
  /** Rounds of the selected phase; `null` until they load (or without a phase). */
  rounds: AdminMatchRoundOption[] | null;
  roundsPending: boolean;
  /** Names the list response resolved for `player` / `player2`. */
  playerNames: Readonly<Record<string, string>>;
  /** The list has not answered yet, so a player name may still arrive. */
  playersPending: boolean;
  /** Load-failure alerts, rendered between the selects and the status tabs. */
  alerts?: ReactNode;
}

/**
 * The filter bar of `/admin/matches`: search, League / Phase / Round, status tabs, quick
 * filters, sort, a collapsed "More filters" panel (date, format, player, content, visibility)
 * and one removable chip per active filter. State lives in the URL (`url` / `update`).
 */
export default function AdminMatchFilters({
  url,
  update,
  searchInput,
  onSearchChange,
  options,
  optionsFailed,
  rounds,
  roundsPending,
  playerNames,
  playersPending,
  alerts,
}: AdminMatchFiltersProps) {
  const t = useT(shellMessages);
  const te = useT(enumMessages);
  const f = useFormatter();
  const locale = useLocale();
  const errorText = useApiErrorText(errorsAdmin);
  const panelId = useId();

  const [panelOpen, setPanelOpen] = useState(false);
  // The date field before any date is chosen: the URL only keeps it together with a date.
  const [draftDateField, setDraftDateField] = useState<AdminMatchDateField>(url.dateField);

  // Players seen by the pickers, to show a picked id by name.
  const [seenNames, setSeenNames] = useState<Record<string, string>>({});
  const remember = useCallback((hits: readonly PlayerSearchHit[]) => {
    setSeenNames((prev) => {
      let next = prev;
      for (const hit of hits) {
        if (prev[hit.id] === hit.name) continue;
        if (next === prev) next = { ...prev };
        next[hit.id] = hit.name;
      }
      return next;
    });
  }, []);
  const playerName = (id: string) =>
    seenNames[id] ?? playerNames[id] ?? (playersPending ? t('admin.matches.loadingOption') : t('admin.matches.player.unknown'));

  const scope = matchPlayerSearchScope(options, url);
  const firstPicker = usePlayerPicker(scope, url.player2, remember);
  const secondPicker = usePlayerPicker(scope, url.player, remember);

  // ── League -> phase -> round ──
  const optionLabel = (name: string, flags: { archived: boolean; test?: boolean }) => {
    let label = name;
    if (flags.test) label = t('admin.matches.testOption', { name: label });
    if (flags.archived) label = t('admin.matches.archivedOption', { name: label });
    return label;
  };

  const selectedLeague: AdminMatchLeagueOption | undefined = options?.leagues.find((l) => l.id === url.league);
  const phaseChoices: readonly (AdminMatchPhaseOption | AdminMatchStandaloneOption)[] =
    url.league === STANDALONE_LEAGUE ? (options?.tournaments ?? []) : (selectedLeague?.phases ?? []);
  const isStandalone = url.league === STANDALONE_LEAGUE;
  const phaseAll = isStandalone ? t('admin.matches.allTournaments') : t('admin.matches.allPhases');
  const phaseLabel = isStandalone ? t('admin.matches.tournament') : t('admin.matches.phase');
  const selectedPhase = phaseChoices.find((p) => p.id === url.phase);

  const leagueKnown = url.league === '' || isStandalone || selectedLeague !== undefined;
  const phaseKnown = url.phase === '' || selectedPhase !== undefined;
  const roundKnown = url.round === '' || (rounds?.some((r) => r.id === url.round) ?? false);

  // A deep-linked id the choices do not (yet) contain: a neutral label while they load, the id only once they
  // failed to load or really lack it.
  const optionsPending = options === null && !optionsFailed;
  const unknownOptionLabel = (id: string) => (optionsPending ? t('admin.matches.loadingOption') : id);
  const unknownRoundLabel = (id: string) => (roundsPending ? t('admin.matches.loadingOption') : id);

  const roundLabel = (round: Pick<AdminMatchRoundOption, 'name' | 'round_number'>) =>
    round.name.trim()
      ? translateEngineLabel('round', round.name, locale)
      : t('admin.matches.roundNumber', { number: round.round_number });

  const rulesets = rulesetChoices(options, url);
  const rulesetKnown = url.ruleset === '' || rulesets.some((r) => r.id === url.ruleset);
  const rulesetName = (id: string) => options?.rulesets.find((r) => r.id === id)?.name ?? unknownOptionLabel(id);

  // ── Quick filters ──
  const presetLabel = (preset: AdminMatchPreset): string => {
    switch (preset) {
      case 'auto_confirms_soon':
        return t('admin.matches.preset.auto_confirms_soon', { hours: f.number(ADMIN_MATCH_AUTO_CONFIRM_SOON_HOURS) });
      case 'stale_in_progress':
        return t('admin.matches.preset.stale_in_progress', { days: f.number(ADMIN_MATCH_STALE_IN_PROGRESS_DAYS) });
      case 'awaiting_confirmation':
        return t('admin.matches.preset.awaiting_confirmation');
      case 'overdue':
        return t('admin.matches.preset.overdue');
    }
  };
  /** One preset at a time; choosing one clears the status tab (the preset names its own status), pressing it again clears it. */
  const togglePreset = (preset: AdminMatchPreset) =>
    update(url.preset === preset ? { preset: '', page: 1 } : { preset, status: '', page: 1 });

  // ── Date ──
  const dateActive = url.range !== '' || url.from !== '' || url.to !== '';
  const dateField = dateActive ? url.dateField : draftDateField;
  const changeDateField = (next: AdminMatchDateField) => {
    setDraftDateField(next);
    if (!dateActive) return;
    // "No date set" only exists for the nullable columns.
    const dropNone = url.range === 'none' && !NULLABLE_DATE_FIELDS.includes(next);
    update({ dateField: next, ...(dropNone ? { range: '' } : {}), page: 1 });
  };
  const pickRange = (range: AdminMatchDateRange) =>
    update(url.range === range ? { range: '', page: 1 } : { range, from: '', to: '', dateField, page: 1 });
  const changeDay = (which: 'from' | 'to', value: string) =>
    update({ ...(which === 'from' ? { from: value } : { to: value }), range: '', dateField, page: 1 });

  // ── Chips ──
  const activeKeys = activeMatchListFilters(url);
  const chipKeys = activeKeys.filter((key) => key !== 'player2');
  const panelActiveCount = chipKeys.filter((key) => PANEL_FILTER_KEYS.includes(key)).length;

  const labeled = (name: string, value: string) => t('admin.matches.chip.labeled', { name, value });
  const chipLabel = (key: MatchListFilterKey): string => {
    switch (key) {
      case 'status':
        return url.status ? t(`admin.matches.status.${url.status}`) : '';
      case 'league':
        return labeled(
          t('admin.matches.league'),
          isStandalone
            ? t('admin.matches.noLeague')
            : selectedLeague
              ? selectedLeague.name
              : unknownOptionLabel(url.league),
        );
      case 'phase':
        return labeled(phaseLabel, selectedPhase ? selectedPhase.name : unknownOptionLabel(url.phase));
      case 'round': {
        const round = rounds?.find((r) => r.id === url.round);
        return labeled(t('admin.matches.round'), round ? roundLabel(round) : unknownRoundLabel(url.round));
      }
      case 'q':
        return t('admin.matches.chip.search', { text: url.q });
      case 'preset':
        return url.preset ? presetLabel(url.preset) : '';
      case 'date': {
        const field = t(`admin.matches.date.fieldOption.${url.dateField}`);
        if (url.range) return labeled(field, t(`admin.matches.date.range.${url.range}`));
        if (url.from && url.to) {
          return t('admin.matches.chip.dateRange', { field, from: f.calendarDate(url.from), to: f.calendarDate(url.to) });
        }
        if (url.from) return t('admin.matches.chip.dateFrom', { field, from: f.calendarDate(url.from) });
        return t('admin.matches.chip.dateTo', { field, to: f.calendarDate(url.to) });
      }
      case 'format':
        return labeled(t('admin.matches.format.type'), enumLabel(te, 'formatType', url.format));
      case 'bracket':
        return labeled(t('admin.matches.format.bracket'), enumLabel(te, 'bracketType', url.bracket));
      case 'bestOf':
        return labeled(t('admin.matches.format.bestOf'), t('admin.matches.format.bestOfOption', { count: url.bestOf ?? 0 }));
      case 'ruleset':
        return labeled(t('admin.matches.format.ruleset'), rulesetName(url.ruleset));
      case 'player':
        return url.player2
          ? t('admin.matches.chip.headToHead', { player1: playerName(url.player), player2: playerName(url.player2) })
          : labeled(t('admin.matches.player.label'), playerName(url.player));
      case 'player2':
        return playerName(url.player2);
      case 'replay':
        return labeled(
          t('admin.matches.content.replay'),
          url.replay === 'has' ? t('admin.matches.content.replayHas') : t('admin.matches.content.replayNone'),
        );
      case 'edited':
        return t('admin.matches.content.edited');
      case 'notes':
        return t('admin.matches.content.notes');
      case 'noGames':
        return t('admin.matches.content.noGames');
      case 'showTest':
        return t('admin.matches.hygiene.showTest');
      case 'showArchived':
        return t('admin.matches.hygiene.showArchived');
    }
  };

  return (
    <section aria-label={t('admin.matches.filtersRegion')} className="space-y-4">
      {/* Search + League / Phase / Round */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-poke-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            maxLength={ADMIN_MATCH_SEARCH_MAX_LENGTH}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('admin.matches.searchPlaceholder')}
            aria-label={t('admin.matches.searchLabel')}
            className="w-full pl-9 pr-3 py-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:w-[48rem]">
          <select
            value={url.league}
            onChange={(e) =>
              update({
                league: e.target.value,
                phase: '',
                round: '',
                // The league format is a property of a league; standalone tournaments have none.
                ...(e.target.value === STANDALONE_LEAGUE ? { format: '' as const } : {}),
                page: 1,
              })
            }
            aria-label={t('admin.matches.league')}
            className={SELECT_CLASSES}
          >
            <option value="">{t('admin.matches.allLeagues')}</option>
            <option value={STANDALONE_LEAGUE}>{t('admin.matches.noLeague')}</option>
            {!leagueKnown && <option value={url.league}>{unknownOptionLabel(url.league)}</option>}
            {options?.leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {optionLabel(league.name, { archived: league.archived, test: league.is_test_season })}
              </option>
            ))}
          </select>
          <select
            value={url.phase}
            onChange={(e) => update({ phase: e.target.value, round: '', page: 1 })}
            disabled={url.league === ''}
            aria-label={phaseLabel}
            className={SELECT_CLASSES}
          >
            <option value="">{phaseAll}</option>
            {!phaseKnown && <option value={url.phase}>{unknownOptionLabel(url.phase)}</option>}
            {phaseChoices.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {optionLabel(phase.name, { archived: phase.archived })}
              </option>
            ))}
          </select>
          <select
            value={url.round}
            onChange={(e) => update({ round: e.target.value, page: 1 })}
            disabled={url.phase === ''}
            aria-label={t('admin.matches.round')}
            className={SELECT_CLASSES}
          >
            <option value="">{t('admin.matches.allRounds')}</option>
            {!roundKnown && <option value={url.round}>{unknownRoundLabel(url.round)}</option>}
            {rounds?.map((round) => (
              <option key={round.id} value={round.id}>
                {roundLabel(round)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {alerts}

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-poke-border overflow-x-auto">
        {STATUS_TABS.map((status) => (
          <button
            key={status || 'all'}
            type="button"
            onClick={() => update({ status, page: 1 })}
            aria-pressed={url.status === status}
            className={`px-3 py-2 text-xs font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              url.status === status
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-primary'
            }`}
          >
            {t(`admin.matches.status.${status || 'all'}`)}
          </button>
        ))}
      </div>

      {/* Quick filters, sort and the disclosure */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('admin.matches.presetsLabel')} className="flex flex-wrap items-center gap-2">
          {ADMIN_MATCH_PRESETS.map((preset) => (
            <ToggleButton key={preset} pressed={url.preset === preset} onClick={() => togglePreset(preset)}>
              {presetLabel(preset)}
            </ToggleButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-heading font-semibold text-poke-text-secondary">
            <span>{t('admin.matches.sortLabel')}</span>
            <select
              value={url.sort}
              onChange={(e) => {
                const sort = ADMIN_MATCH_SORTS.find((s) => s === e.target.value);
                if (sort) update({ sort, page: 1 });
              }}
              className={`${SELECT_CLASSES} w-auto font-normal`}
            >
              {ADMIN_MATCH_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`admin.matches.sort.${sort}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-heading font-medium rounded-poke-md border border-poke-border text-poke-text-primary hover:border-poke-border-focus transition-colors"
          >
            {panelActiveCount > 0
              ? t('admin.matches.moreFiltersActive', { count: f.number(panelActiveCount) })
              : t('admin.matches.moreFilters')}
            <svg
              className={`w-3.5 h-3.5 transition-transform ${panelOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* "More filters": rendered while collapsed (hidden), so a deep link's controls are in the document. */}
      <div id={panelId} hidden={!panelOpen} className={panelOpen ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'hidden'}>
        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.date.legend')}</legend>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.field')}</span>
            <select
              value={dateField}
              onChange={(e) => {
                const field = ADMIN_MATCH_DATE_FIELDS.find((d) => d === e.target.value);
                if (field) changeDateField(field);
              }}
              className={SELECT_CLASSES}
            >
              {ADMIN_MATCH_DATE_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`admin.matches.date.fieldOption.${field}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.from')}</span>
              <input
                type="date"
                value={url.from}
                max={url.to || undefined}
                onChange={(e) => changeDay('from', e.target.value)}
                className={SELECT_CLASSES}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.to')}</span>
              <input
                type="date"
                value={url.to}
                min={url.from || undefined}
                onChange={(e) => changeDay('to', e.target.value)}
                className={SELECT_CLASSES}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {ADMIN_MATCH_DATE_RANGES.map((range) => (
              <ToggleButton
                key={range}
                pressed={url.range === range}
                onClick={() => pickRange(range)}
                disabled={range === 'none' && !NULLABLE_DATE_FIELDS.includes(dateField)}
              >
                {t(`admin.matches.date.range.${range}`)}
              </ToggleButton>
            ))}
            <ToggleButton pressed={url.preset === 'overdue'} onClick={() => togglePreset('overdue')}>
              {presetLabel('overdue')}
            </ToggleButton>
          </div>
        </fieldset>

        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.format.legend')}</legend>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.type')}</span>
            <select
              value={url.format}
              onChange={(e) => {
                const format = ADMIN_MATCH_FORMAT_TYPES.find((v) => v === e.target.value);
                update({ format: format ?? '', page: 1 });
              }}
              disabled={isStandalone}
              className={SELECT_CLASSES}
            >
              <option value="">{t('admin.matches.format.anyType')}</option>
              {ADMIN_MATCH_FORMAT_TYPES.map((format) => (
                <option key={format} value={format}>
                  {enumLabel(te, 'formatType', format)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.bracket')}</span>
            <select
              value={url.bracket}
              onChange={(e) => {
                const bracket = ADMIN_MATCH_BRACKET_TYPES.find((v) => v === e.target.value);
                update({ bracket: bracket ?? '', page: 1 });
              }}
              className={SELECT_CLASSES}
            >
              <option value="">{t('admin.matches.format.anyBracket')}</option>
              {ADMIN_MATCH_BRACKET_TYPES.map((bracket) => (
                <option key={bracket} value={bracket}>
                  {enumLabel(te, 'bracketType', bracket)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.bestOf')}</span>
              <select
                value={url.bestOf === null ? '' : String(url.bestOf)}
                onChange={(e) => update({ bestOf: e.target.value === '' ? null : Number(e.target.value), page: 1 })}
                className={SELECT_CLASSES}
              >
                <option value="">{t('admin.matches.format.anyBestOf')}</option>
                {/* A deep-linked value outside the usual 1 / 3 / 5 stays selectable. */}
                {url.bestOf !== null && !(ADMIN_MATCH_BEST_OF_CHOICES as readonly number[]).includes(url.bestOf) && (
                  <option value={url.bestOf}>{t('admin.matches.format.bestOfOption', { count: url.bestOf })}</option>
                )}
                {ADMIN_MATCH_BEST_OF_CHOICES.map((count) => (
                  <option key={count} value={count}>
                    {t('admin.matches.format.bestOfOption', { count })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.ruleset')}</span>
              <select
                value={url.ruleset}
                onChange={(e) => update({ ruleset: e.target.value, page: 1 })}
                className={SELECT_CLASSES}
              >
                <option value="">{t('admin.matches.format.anyRuleset')}</option>
                {!rulesetKnown && <option value={url.ruleset}>{rulesetName(url.ruleset)}</option>}
                {rulesets.map((ruleset) => (
                  <option key={ruleset.id} value={ruleset.id}>
                    {ruleset.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.player.legend')}</legend>
          <div>
            <Combobox
              mode="async"
              label={t('admin.matches.player.label')}
              value={url.player ? playerName(url.player) : ''}
              onChange={(id) => update({ player: id, player2: '', page: 1 })}
              placeholder={t('admin.matches.player.placeholder')}
              fetchUrl={firstPicker.fetchUrl}
              transformResults={firstPicker.transformResults}
              onFetchError={firstPicker.onFetchError}
              minQueryLength={PLAYER_SEARCH_MIN_QUERY}
              disabled={scope === null}
            />
            <PlayerSearchNotes picker={firstPicker} errorText={errorText} />
          </div>
          {url.player !== '' && (
            <div>
              <Combobox
                mode="async"
                label={t('admin.matches.player.second')}
                value={url.player2 ? playerName(url.player2) : ''}
                onChange={(id) => update({ player2: id, page: 1 })}
                placeholder={t('admin.matches.player.secondPlaceholder')}
                fetchUrl={secondPicker.fetchUrl}
                transformResults={secondPicker.transformResults}
                onFetchError={secondPicker.onFetchError}
                minQueryLength={PLAYER_SEARCH_MIN_QUERY}
                disabled={scope === null}
              />
              <PlayerSearchNotes picker={secondPicker} errorText={errorText} />
            </div>
          )}
          {scope === null && options !== null && (
            <p className="text-xs text-poke-text-muted">{t('admin.matches.player.noScope')}</p>
          )}
        </fieldset>

        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.content.legend')}</legend>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.content.replay')}</span>
            <select
              value={url.replay}
              onChange={(e) => {
                const replay = e.target.value === 'has' || e.target.value === 'none' ? e.target.value : '';
                // "No games recorded" cannot have a replay, and "no replay" cannot be told apart from a
                // hand-edited game in one query: drop the combinations the API refuses.
                update({
                  replay,
                  ...(replay === 'has' ? { noGames: false } : {}),
                  ...(replay === 'none' ? { edited: false } : {}),
                  page: 1,
                });
              }}
              className={SELECT_CLASSES}
            >
              <option value="">{t('admin.matches.content.replayAny')}</option>
              <option value="has">{t('admin.matches.content.replayHas')}</option>
              <option value="none">{t('admin.matches.content.replayNone')}</option>
            </select>
          </label>
          <CheckboxField
            checked={url.edited}
            onChange={(edited) =>
              update({
                edited,
                ...(edited ? { noGames: false, ...(url.replay === 'none' ? { replay: '' as const } : {}) } : {}),
                page: 1,
              })
            }
            label={t('admin.matches.content.edited')}
          />
          <CheckboxField
            checked={url.notes}
            onChange={(notes) => update({ notes, page: 1 })}
            label={t('admin.matches.content.notes')}
          />
          <CheckboxField
            checked={url.noGames}
            onChange={(noGames) =>
              // Without games there is no replay and nothing hand-edited: drop the combinations the API refuses.
              update({
                noGames,
                ...(noGames ? { edited: false, ...(url.replay === 'has' ? { replay: '' as const } : {}) } : {}),
                page: 1,
              })
            }
            label={t('admin.matches.content.noGames')}
          />
        </fieldset>

        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.hygiene.legend')}</legend>
          <CheckboxField
            checked={url.showTest}
            onChange={(showTest) => update({ showTest, page: 1 })}
            label={t('admin.matches.hygiene.showTest')}
          />
          <CheckboxField
            checked={url.showArchived}
            onChange={(showArchived) => update({ showArchived, page: 1 })}
            label={t('admin.matches.hygiene.showArchived')}
          />
        </fieldset>
      </div>

      {/* Active filters */}
      {chipKeys.length > 0 && (
        <div role="group" aria-label={t('admin.matches.activeFilters')} className="flex flex-wrap items-center gap-2">
          {chipKeys.map((key) => {
            const label = chipLabel(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => update(clearMatchListFilters(url, [key]))}
                aria-label={t('admin.matches.removeFilter', { label })}
                className="inline-flex items-center gap-1.5 max-w-full pl-2.5 pr-2 py-1 text-xs font-heading font-medium rounded-full border border-poke-border bg-poke-elevated text-poke-text-primary hover:border-poke-danger hover:text-poke-danger transition-colors"
              >
                <span className="truncate">{label}</span>
                <svg
                  className="w-3 h-3 shrink-0"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => update(clearMatchListFilters(url))}
            className="px-2 py-1 text-xs font-heading font-medium text-poke-text-muted underline hover:text-poke-text-primary transition-colors"
          >
            {t('admin.matches.clearAll')}
          </button>
        </div>
      )}
    </section>
  );
}

/** A picker's refusal (by its code) and the "more matches than shown" hint, under its input. */
function PlayerSearchNotes({
  picker,
  errorText,
}: {
  picker: { error: ApiErrorLike | null; more: { shown: number; total: number } | null };
  errorText: (error: ApiErrorLike) => string;
}) {
  const t = useT(shellMessages);
  const f = useFormatter();
  return (
    <>
      {picker.error && (
        <Alert variant="error" className="mt-1">
          {errorText(picker.error)}
        </Alert>
      )}
      {picker.more && (
        <p className="mt-1 text-xs text-poke-text-muted">
          {t('admin.matches.player.searchTruncated', { shown: f.number(picker.more.shown), total: f.number(picker.more.total) })}
        </p>
      )}
    </>
  );
}
