'use client';

import { useState } from 'react';
import SheetIcon from '@/components/shared/SheetIcon';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import { describeTeamRules } from '@/lib/ruleset-kit/describe';
import type { TeamConstraints } from '@/types/ruleset';

/** One listed entry: its canonical English name and, for Pokémon and items, the cell of its icon on the Showdown sheet. */
export interface DetailEntry {
  name: string;
  /** The icon-sheet cell (`null`: the sheet has none; absent: moves and abilities have no icon). */
  ic?: number | null;
}

/** A clause as the detail prints it. */
export interface DetailClause {
  name: string;
  /** The team check does not enforce it; it applies in the battle. */
  informational: boolean;
}

interface DetailLists {
  pokemon: readonly DetailEntry[];
  moves: readonly DetailEntry[];
  items: readonly DetailEntry[];
  abilities: readonly DetailEntry[];
}

/** The fields the detail shows (names are canonical English, as stored). */
export interface RulesetDetailContent {
  /** The format's display name, resolved on the server (Showdown name, stays English). */
  formatName: string;
  isDoubles: boolean;
  /** The version of the stored ruleset; `null` for one built in code. */
  version: number | null;
  /** Clause names; they stay English. */
  clauses: readonly DetailClause[];
  bans: DetailLists;
  /** A list in allowlist mode: the only entries that are legal. `null`: the list is not an allowlist. */
  allow: { [K in keyof DetailLists]: DetailLists[K] | null };
  addedPokemon: readonly DetailEntry[];
  minSharedTypePct: number;
  /** The team rules beyond the shared-type rule, printed as sentences. */
  teamConstraints: TeamConstraints | null;
  customRules: string;
}

/** Already-resolved label text (an override from `RulesetDetail`'s `labels`). */
export interface RulesetDetailText {
  doubles: string;
  clauses: string;
  bannedPokemon: string;
  bannedMoves: string;
  bannedItems: string;
  bannedAbilities: string;
  addedPokemon: string;
  sharedType: string;
  /** The shared-type rule sentence for this ruleset's percentage. */
  sharedTypeRule: string;
  customRules: string;
}

interface RulesetDetailViewProps {
  content: RulesetDetailContent;
  blockTag: 'section' | 'div';
  text?: RulesetDetailText;
}

/** A list with this many entries or more gets the search field (a format's ban list runs to dozens of Pokémon). */
const SEARCH_FROM = 12;

/** The rule of a list: its entries are banned, or they are the only legal ones (or added back). */
type ListTone = 'ban' | 'allow';
const LIST_EDGE: Record<ListTone, string> = { ban: 'border-loss', allow: 'border-win' };

type Localize = (name: string, locale: DataLocale) => string;
type IconSheet = 'pokemon' | 'item' | null;

/**
 * The ruleset detail in the viewer's language (render it through `RulesetDetail`). Read-only: the version, the clauses (those
 * the team check does not enforce are dashed and read out as informational), the four lists as bans or as allowlists, the
 * Pokémon the format key bans that are allowed here, the shared-type rule and the team rules. Each list is a grid of
 * names under its heading; once the lists hold a dozen entries, one search field filters all of them (plan §4.2, B3).
 */
export default function RulesetDetailView({ content, blockTag: Block, text: override }: RulesetDetailViewProps) {
  const t = useT(rulesetMessages);
  const dl = useDataLocale();
  const locale = useLocale();
  const text: RulesetDetailText = override ?? {
    doubles: t('detail.doubles'),
    clauses: t('detail.clauses'),
    bannedPokemon: t('detail.bannedPokemon'),
    bannedMoves: t('detail.bannedMoves'),
    bannedItems: t('detail.bannedItems'),
    bannedAbilities: t('detail.bannedAbilities'),
    addedPokemon: t('detail.addedPokemon'),
    sharedType: t('detail.sharedType'),
    sharedTypeRule: t('detail.sharedTypeRule', { percent: content.minSharedTypePct }),
    customRules: t('detail.customRules'),
  };
  const { bans, allow } = content;
  const teamRules = describeTeamRules({ min_shared_type_pct: 0, team_constraints: content.teamConstraints }, locale, locale);

  const totalBans = bans.pokemon.length + bans.moves.length + bans.items.length + bans.abilities.length;
  const hasAllowlist = allow.pokemon !== null || allow.moves !== null || allow.items !== null || allow.abilities !== null;
  const hasInformational = content.clauses.some((clause) => clause.informational);

  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const lists: { key: string; heading: string; entries: readonly DetailEntry[]; localize: Localize; sheet: IconSheet; tone: ListTone; showEmpty: boolean }[] = [
    { key: 'ban-pokemon', heading: text.bannedPokemon, entries: bans.pokemon, localize: localizeSpecies, sheet: 'pokemon', tone: 'ban', showEmpty: false },
    { key: 'ban-moves', heading: text.bannedMoves, entries: bans.moves, localize: localizeMove, sheet: null, tone: 'ban', showEmpty: false },
    { key: 'ban-items', heading: text.bannedItems, entries: bans.items, localize: localizeItem, sheet: 'item', tone: 'ban', showEmpty: false },
    { key: 'ban-abilities', heading: text.bannedAbilities, entries: bans.abilities, localize: localizeAbility, sheet: null, tone: 'ban', showEmpty: false },
    ...(allow.pokemon !== null ? [{ key: 'allow-pokemon', heading: t('detail.allowedPokemon'), entries: allow.pokemon, localize: localizeSpecies, sheet: 'pokemon' as const, tone: 'allow' as const, showEmpty: true }] : []),
    ...(allow.moves !== null ? [{ key: 'allow-moves', heading: t('detail.allowedMoves'), entries: allow.moves, localize: localizeMove, sheet: null, tone: 'allow' as const, showEmpty: true }] : []),
    ...(allow.items !== null ? [{ key: 'allow-items', heading: t('detail.allowedItems'), entries: allow.items, localize: localizeItem, sheet: 'item' as const, tone: 'allow' as const, showEmpty: true }] : []),
    ...(allow.abilities !== null ? [{ key: 'allow-abilities', heading: t('detail.allowedAbilities'), entries: allow.abilities, localize: localizeAbility, sheet: null, tone: 'allow' as const, showEmpty: true }] : []),
    { key: 'added-pokemon', heading: text.addedPokemon, entries: content.addedPokemon, localize: localizeSpecies, sheet: 'pokemon', tone: 'allow', showEmpty: false },
  ];
  const searchable = lists.reduce((sum, list) => sum + list.entries.length, 0) >= SEARCH_FROM;
  const shown = lists.map((list) => ({
    ...list,
    matches: needle
      ? list.entries.filter((entry) => entry.name.toLowerCase().includes(needle) || list.localize(entry.name, dl).toLowerCase().includes(needle))
      : list.entries,
  }));
  const noMatch = needle !== '' && shown.every((list) => list.matches.length === 0);

  const hasContent =
    content.clauses.length > 0 ||
    totalBans > 0 ||
    hasAllowlist ||
    content.addedPokemon.length > 0 ||
    content.minSharedTypePct > 0 ||
    teamRules.length > 0 ||
    content.customRules;

  const formatChips = (
    <div className="flex flex-wrap gap-3 text-sm">
      <span className="px-2 py-0.5 bg-tier-3 text-tier-ink rounded">
        {content.formatName}
      </span>
      {content.isDoubles && (
        <span className="px-2 py-0.5 bg-tier-2 text-tier-ink rounded">{text.doubles}</span>
      )}
      {content.version !== null && (
        <span className="px-2 py-0.5 bg-poke-muted text-poke-text-secondary rounded">{t('detail.version', { version: content.version })}</span>
      )}
    </div>
  );

  if (!hasContent) return formatChips;

  return (
    <div className="space-y-4">
      {formatChips}

      {content.clauses.length > 0 && (
        <Block>
          <h3 className="font-semibold text-sm mb-2">{text.clauses}</h3>
          <div className="flex flex-wrap gap-1">
            {content.clauses.map((clause) => (
              <span
                key={clause.name}
                className={
                  clause.informational
                    ? 'px-2 py-0.5 border border-dashed border-poke-border-strong text-poke-text-secondary rounded text-xs'
                    : 'px-2 py-0.5 bg-tier-3 text-tier-ink rounded text-xs'
                }
              >
                {clause.name}
                {clause.informational && <span className="sr-only"> ({t('detail.informational')})</span>}
              </span>
            ))}
          </div>
          {hasInformational && <p className="mt-2 text-xs text-poke-text-muted">{t('detail.informationalNote')}</p>}
        </Block>
      )}

      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('detail.search')}
          placeholder={t('detail.search')}
          className="w-full max-w-sm rounded-poke-sm border border-hairline-strong bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus max-sm:min-h-11"
        />
      )}
      {noMatch && <p className="text-body text-fg-muted">{t('detail.noMatches', { query: query.trim() })}</p>}

      {shown.map((list) =>
        needle !== '' && list.matches.length === 0 ? null : (
          <NameBlock
            key={list.key}
            Block={Block}
            heading={list.heading}
            count={list.entries.length}
            entries={list.matches}
            localize={list.localize}
            sheet={list.sheet}
            dl={dl}
            tone={list.tone}
            showEmpty={list.showEmpty}
          />
        ),
      )}

      {(content.minSharedTypePct > 0 || teamRules.length > 0) && (
        <Block>
          <h3 className="font-semibold text-sm mb-2">{content.minSharedTypePct > 0 && teamRules.length === 0 ? text.sharedType : t('detail.teamRules')}</h3>
          <div className="flex flex-wrap gap-1">
            {content.minSharedTypePct > 0 && (
              <span className="px-2 py-0.5 bg-tier-1 text-tier-ink rounded text-xs">
                {text.sharedTypeRule}
              </span>
            )}
            {teamRules.map((line) => (
              <span key={line} className="px-2 py-0.5 bg-tier-1 text-tier-ink rounded text-xs">
                {line}
              </span>
            ))}
          </div>
        </Block>
      )}

      {content.customRules && (
        <Block>
          <h3 className="font-semibold text-sm mb-2">{text.customRules}</h3>
          <pre className="whitespace-pre-wrap rounded border border-poke-border bg-poke-elevated p-3 text-xs text-poke-text-primary">{content.customRules}</pre>
        </Block>
      )}
    </div>
  );
}

/** One list of entries under "<heading> (<count>)"; nothing when the list is empty (an allowlist shows even when empty). */
function NameBlock({
  Block,
  heading,
  count,
  entries,
  localize,
  sheet,
  dl,
  tone,
  showEmpty,
}: {
  Block: 'section' | 'div';
  heading: string;
  /** The list's size, whatever the search shows of it. */
  count: number;
  entries: readonly DetailEntry[];
  localize: Localize;
  sheet: IconSheet;
  dl: DataLocale;
  tone: ListTone;
  showEmpty: boolean;
}) {
  const t = useT(rulesetMessages);
  if (count === 0 && !showEmpty) return null;
  return (
    <Block>
      <h3 className="font-semibold text-sm mb-2">{t('detail.headingWithCount', { heading, count })}</h3>
      <ul className={`grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-1 border-l-2 pl-3 ${LIST_EDGE[tone]}`}>
        {entries.map((entry) => (
          <li key={entry.name} className="flex min-h-7 min-w-0 items-center gap-2 text-body text-fg">
            {sheet !== null && typeof entry.ic === 'number' && <SheetIcon sheet={sheet} cell={entry.ic} />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{localize(entry.name, dl)}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}
