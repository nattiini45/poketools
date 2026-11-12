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
import { matchPlayerSearchScope, offersStandaloneLeague, rulesetChoices } from '@/components/admin/match-list-view';
import { ChevronDown, Search, X } from 'lucide-react';
import { FOCUS } from '@/components/admin/match-styles';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
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

const FIELD_LABEL_CLASSES = 'mb-1.5 block text-caption font-medium text-fg';
const FIELDSET_CLASSES = 'min-w-0 space-y-3 rounded-poke-md border border-hairline bg-elevated p-3';
const LEGEND_CLASSES = 'px-1 text-caption font-[550] text-fg-muted';
/** A pill is a full 44 px target on a phone and 28 px from `sm` up. */
const TOGGLE_BASE_CLASSES = `inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-caption motion-safe:transition-colors motion-safe:duration-80 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-7 ${FOCUS}`;
const TOGGLE_ON_CLASSES = 'border-accent-ink bg-accent-subtle text-accent-ink';
const TOGGLE_OFF_CLASSES = 'border-hairline-strong text-fg-muted hover:bg-hover hover:text-fg';
/**
 * A status tab: a skewed plate drawn behind the label (the label stays the button's only child, which the list's
 * tests read), with the amber underside on the pressed one.
 */
const STATUS_TAB_CLASSES =
  'relative isolate inline-flex min-h-11 items-center whitespace-nowrap px-3.5 text-body sm:min-h-8 before:absolute before:inset-0 before:-z-1 before:rounded-[3px] before:border before:[transform:skewX(var(--skew))] before:motion-safe:transition-colors before:motion-safe:duration-80 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-b-[3px] after:[transform:skewX(var(--skew))] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-solid focus-visible:before:outline-offset-2 focus-visible:before:outline-[var(--focus-ring)]';
const STATUS_TAB_ON_CLASSES = 'font-[550] text-tier-ink before:border-transparent before:bg-tier-1 after:bg-accent-fill';
const STATUS_TAB_OFF_CLASSES = 'text-fg-muted hover:text-fg before:border-hairline before:bg-transparent hover:before:bg-hover';
/** The selects of the bar sit on the 36 px step next to the search field. */
const SELECT_SIZE = 'h-9';

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
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-body text-fg sm:min-h-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`size-4 shrink-0 cursor-pointer accent-accent-fill ${FOCUS}`}
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
  // A phase the options lack never shows its id: the list drops such a phase once the options are known.
  const unknownLeagueLabel = (id: string) =>
    optionsPending || optionsFailed ? unknownOptionLabel(id) : t('admin.matches.unknownOption');
  const unknownPhaseLabel = () => t(optionsPending ? 'admin.matches.loadingOption' : 'admin.matches.unknownOption');
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
              : unknownLeagueLabel(url.league),
        );
      case 'phase':
        return labeled(phaseLabel, selectedPhase ? selectedPhase.name : unknownPhaseLabel());
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
    <section
      aria-label={t('admin.matches.filtersRegion')}
      className="flex flex-col gap-4 rounded-poke-lg border border-hairline bg-surface p-4"
      data-admin-match-filters
    >
      {/* Search + League / Phase / Round. On a phone the three scope selects open with "More filters". */}
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="relative flex-1" role="search">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <Input
            type="text"
            value={searchInput}
            maxLength={ADMIN_MATCH_SEARCH_MAX_LENGTH}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('admin.matches.searchPlaceholder')}
            aria-label={t('admin.matches.searchLabel')}
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <div className={`grid-cols-1 gap-3 sm:grid sm:grid-cols-3 xl:w-[40rem] ${panelOpen ? 'grid' : 'hidden'}`}>
          <Select
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
            className={SELECT_SIZE}
          >
            <option value="">{t('admin.matches.allLeagues')}</option>
            {offersStandaloneLeague(options, isStandalone) && (
              <option value={STANDALONE_LEAGUE}>{t('admin.matches.noLeague')}</option>
            )}
            {!leagueKnown && <option value={url.league}>{unknownLeagueLabel(url.league)}</option>}
            {options?.leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {optionLabel(league.name, { archived: league.archived, test: league.is_test_season })}
              </option>
            ))}
          </Select>
          <Select
            value={url.phase}
            onChange={(e) => update({ phase: e.target.value, round: '', page: 1 })}
            disabled={url.league === ''}
            aria-label={phaseLabel}
            className={SELECT_SIZE}
          >
            <option value="">{phaseAll}</option>
            {!phaseKnown && <option value={url.phase}>{unknownPhaseLabel()}</option>}
            {phaseChoices.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {optionLabel(phase.name, { archived: phase.archived })}
              </option>
            ))}
          </Select>
          <Select
            value={url.round}
            onChange={(e) => update({ round: e.target.value, page: 1 })}
            disabled={url.phase === ''}
            aria-label={t('admin.matches.round')}
            className={SELECT_SIZE}
          >
            <option value="">{t('admin.matches.allRounds')}</option>
            {!roundKnown && <option value={url.round}>{unknownRoundLabel(url.round)}</option>}
            {rounds?.map((round) => (
              <option key={round.id} value={round.id}>
                {roundLabel(round)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {alerts}

      {/* Status tabs: skewed plates with an accent underside on the pressed one; the strip scrolls on a phone. */}
      <div className="-mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
        <div className="flex w-max items-center gap-2">
          {STATUS_TABS.map((status) => (
            <button
              key={status || 'all'}
              type="button"
              onClick={() => update({ status, page: 1 })}
              aria-pressed={url.status === status}
              className={`${STATUS_TAB_CLASSES} ${url.status === status ? STATUS_TAB_ON_CLASSES : STATUS_TAB_OFF_CLASSES}`}
            >
              {t(`admin.matches.status.${status || 'all'}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Quick filters, sort and the disclosure */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t('admin.matches.presetsLabel')}
          className="-mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] sm:flex-wrap"
        >
          {ADMIN_MATCH_PRESETS.map((preset) => (
            <ToggleButton key={preset} pressed={url.preset === preset} onClick={() => togglePreset(preset)}>
              {presetLabel(preset)}
            </ToggleButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-fg-muted">
            <span>{t('admin.matches.sortLabel')}</span>
            <Select
              value={url.sort}
              onChange={(e) => {
                const sort = ADMIN_MATCH_SORTS.find((s) => s === e.target.value);
                if (sort) update({ sort, page: 1 });
              }}
              className={SELECT_SIZE}
            >
              {ADMIN_MATCH_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`admin.matches.sort.${sort}`)}
                </option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-poke-md border border-hairline-strong bg-surface px-3 text-body text-fg hover:bg-hover motion-safe:transition-colors motion-safe:duration-80 sm:min-h-9 ${FOCUS}`}
          >
            {panelActiveCount > 0
              ? t('admin.matches.moreFiltersActive', { count: f.number(panelActiveCount) })
              : t('admin.matches.moreFilters')}
            <ChevronDown aria-hidden="true" className={`size-4 text-fg-muted motion-safe:transition-transform ${panelOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* "More filters": rendered while collapsed (hidden), so a deep link's controls are in the document. */}
      <div id={panelId} hidden={!panelOpen} className={panelOpen ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'hidden'}>
        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.date.legend')}</legend>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.field')}</span>
            <Select
              value={dateField}
              onChange={(e) => {
                const field = ADMIN_MATCH_DATE_FIELDS.find((d) => d === e.target.value);
                if (field) changeDateField(field);
              }}
              className={SELECT_SIZE}
            >
              {ADMIN_MATCH_DATE_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`admin.matches.date.fieldOption.${field}`)}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.from')}</span>
              <Input type="date" className="px-2" value={url.from} max={url.to || undefined} onChange={(e) => changeDay('from', e.target.value)} />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.date.to')}</span>
              <Input type="date" className="px-2" value={url.to} min={url.from || undefined} onChange={(e) => changeDay('to', e.target.value)} />
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
            <Select
              value={url.format}
              onChange={(e) => {
                const format = ADMIN_MATCH_FORMAT_TYPES.find((v) => v === e.target.value);
                update({ format: format ?? '', page: 1 });
              }}
              disabled={isStandalone}
              className={SELECT_SIZE}
            >
              <option value="">{t('admin.matches.format.anyType')}</option>
              {ADMIN_MATCH_FORMAT_TYPES.map((format) => (
                <option key={format} value={format}>
                  {enumLabel(te, 'formatType', format)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.bracket')}</span>
            <Select
              value={url.bracket}
              onChange={(e) => {
                const bracket = ADMIN_MATCH_BRACKET_TYPES.find((v) => v === e.target.value);
                update({ bracket: bracket ?? '', page: 1 });
              }}
              className={SELECT_SIZE}
            >
              <option value="">{t('admin.matches.format.anyBracket')}</option>
              {ADMIN_MATCH_BRACKET_TYPES.map((bracket) => (
                <option key={bracket} value={bracket}>
                  {enumLabel(te, 'bracketType', bracket)}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.bestOf')}</span>
            <Select
                value={url.bestOf === null ? '' : String(url.bestOf)}
                onChange={(e) => update({ bestOf: e.target.value === '' ? null : Number(e.target.value), page: 1 })}
                className={SELECT_SIZE}
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
              </Select>
            </label>
            <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.format.ruleset')}</span>
            <Select
                value={url.ruleset}
                onChange={(e) => update({ ruleset: e.target.value, page: 1 })}
                className={SELECT_SIZE}
              >
                <option value="">{t('admin.matches.format.anyRuleset')}</option>
                {!rulesetKnown && <option value={url.ruleset}>{rulesetName(url.ruleset)}</option>}
                {rulesets.map((ruleset) => (
                  <option key={ruleset.id} value={ruleset.id}>
                    {ruleset.name}
                  </option>
                ))}
              </Select>
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
            <p className="text-caption text-fg-muted">{t('admin.matches.player.noScope')}</p>
          )}
        </fieldset>

        <fieldset className={FIELDSET_CLASSES}>
          <legend className={LEGEND_CLASSES}>{t('admin.matches.content.legend')}</legend>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>{t('admin.matches.content.replay')}</span>
            <Select
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
              className={SELECT_SIZE}
            >
              <option value="">{t('admin.matches.content.replayAny')}</option>
              <option value="has">{t('admin.matches.content.replayHas')}</option>
              <option value="none">{t('admin.matches.content.replayNone')}</option>
            </Select>
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
                className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-hairline-strong bg-elevated pl-3 pr-2 text-caption text-fg hover:border-loss hover:text-loss motion-safe:transition-colors motion-safe:duration-80 sm:min-h-7 ${FOCUS}`}
              >
                <span className="truncate">{label}</span>
                <X aria-hidden="true" className="size-3.5 shrink-0" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => update(clearMatchListFilters(url))}
            className={`inline-flex min-h-11 items-center rounded-sm px-2 text-caption text-fg-muted underline underline-offset-2 hover:text-fg sm:min-h-7 ${FOCUS}`}
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
        <p className="mt-1 text-caption text-fg-muted">
          {t('admin.matches.player.searchTruncated', { shown: f.number(picker.more.shown), total: f.number(picker.more.total) })}
        </p>
      )}
    </>
  );
}
