'use client';

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

const CHIP_RED = 'px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 rounded text-xs';
const CHIP_GREEN = 'px-2 py-0.5 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded text-xs';

type Localize = (name: string, locale: DataLocale) => string;
type IconSheet = 'pokemon' | 'item' | null;

/**
 * The ruleset detail in the viewer's language (render it through `RulesetDetail`). Read-only: the version, the clauses (those
 * the team check does not enforce are dashed and read out as informational), the four lists as bans or as allowlists, the
 * Pokémon the format key bans that are allowed here, the shared-type rule and the team rules.
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
      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 rounded">
        {content.formatName}
      </span>
      {content.isDoubles && (
        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 rounded">{text.doubles}</span>
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
                    : 'px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs'
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

      <NameBlock Block={Block} heading={text.bannedPokemon} entries={bans.pokemon} localize={localizeSpecies} sheet="pokemon" dl={dl} />
      <NameBlock Block={Block} heading={text.bannedMoves} entries={bans.moves} localize={localizeMove} sheet={null} dl={dl} />
      <NameBlock Block={Block} heading={text.bannedItems} entries={bans.items} localize={localizeItem} sheet="item" dl={dl} />
      <NameBlock Block={Block} heading={text.bannedAbilities} entries={bans.abilities} localize={localizeAbility} sheet={null} dl={dl} />

      {allow.pokemon !== null && (
        <NameBlock Block={Block} heading={t('detail.allowedPokemon')} entries={allow.pokemon} localize={localizeSpecies} sheet="pokemon" dl={dl} chipClass={CHIP_GREEN} showEmpty />
      )}
      {allow.moves !== null && (
        <NameBlock Block={Block} heading={t('detail.allowedMoves')} entries={allow.moves} localize={localizeMove} sheet={null} dl={dl} chipClass={CHIP_GREEN} showEmpty />
      )}
      {allow.items !== null && (
        <NameBlock Block={Block} heading={t('detail.allowedItems')} entries={allow.items} localize={localizeItem} sheet="item" dl={dl} chipClass={CHIP_GREEN} showEmpty />
      )}
      {allow.abilities !== null && (
        <NameBlock Block={Block} heading={t('detail.allowedAbilities')} entries={allow.abilities} localize={localizeAbility} sheet={null} dl={dl} chipClass={CHIP_GREEN} showEmpty />
      )}

      <NameBlock Block={Block} heading={text.addedPokemon} entries={content.addedPokemon} localize={localizeSpecies} sheet="pokemon" dl={dl} chipClass={CHIP_GREEN} />

      {(content.minSharedTypePct > 0 || teamRules.length > 0) && (
        <Block>
          <h3 className="font-semibold text-sm mb-2">{content.minSharedTypePct > 0 && teamRules.length === 0 ? text.sharedType : t('detail.teamRules')}</h3>
          <div className="flex flex-wrap gap-1">
            {content.minSharedTypePct > 0 && (
              <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-xs">
                {text.sharedTypeRule}
              </span>
            )}
            {teamRules.map((line) => (
              <span key={line} className="px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-xs">
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

/** One list of entries under "<heading> (<count>)"; nothing when empty (an allowlist shows even when empty). */
function NameBlock({
  Block,
  heading,
  entries,
  localize,
  sheet,
  dl,
  chipClass = CHIP_RED,
  showEmpty = false,
}: {
  Block: 'section' | 'div';
  heading: string;
  entries: readonly DetailEntry[];
  localize: Localize;
  sheet: IconSheet;
  dl: DataLocale;
  chipClass?: string;
  showEmpty?: boolean;
}) {
  const t = useT(rulesetMessages);
  if (entries.length === 0 && !showEmpty) return null;
  return (
    <Block>
      <h3 className="font-semibold text-sm mb-2">{t('detail.headingWithCount', { heading, count: entries.length })}</h3>
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => (
          <span key={entry.name} className={`${chipClass} inline-flex items-center gap-1`}>
            {sheet !== null && typeof entry.ic === 'number' && <SheetIcon sheet={sheet} cell={entry.ic} />}
            {localize(entry.name, dl)}
          </span>
        ))}
      </div>
    </Block>
  );
}
