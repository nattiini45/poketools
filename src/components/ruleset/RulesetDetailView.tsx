'use client';

import { useDataLocale, useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

/** The fields the detail shows (names are canonical English, as stored). */
export interface RulesetDetailContent {
  /** The format's display name, resolved on the server (Showdown name, stays English). */
  formatName: string;
  isDoubles: boolean;
  /** Showdown clause names; they stay English. */
  clauses: readonly string[];
  bans: {
    pokemon: readonly string[];
    moves: readonly string[];
    items: readonly string[];
    abilities: readonly string[];
  };
  addedPokemon: readonly string[];
  minSharedTypePct: number;
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

/** The ruleset detail in the viewer's language (render it through `RulesetDetail`). */
export default function RulesetDetailView({ content, blockTag: Block, text: override }: RulesetDetailViewProps) {
  const t = useT(rulesetMessages);
  const dl = useDataLocale();
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
  const { bans } = content;

  const totalBans = bans.pokemon.length + bans.moves.length + bans.items.length + bans.abilities.length;

  const hasContent =
    content.clauses.length > 0 ||
    totalBans > 0 ||
    content.addedPokemon.length > 0 ||
    content.minSharedTypePct > 0 ||
    content.customRules;

  const formatChips = (
    <div className="flex gap-3 text-sm">
      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 rounded">
        {content.formatName}
      </span>
      {content.isDoubles && (
        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 rounded">{text.doubles}</span>
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
            {content.clauses.map((c) => (
              <span key={c} className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">
                {c}
              </span>
            ))}
          </div>
        </Block>
      )}

      <NameBlock Block={Block} heading={text.bannedPokemon} names={bans.pokemon} localize={localizeSpecies} dl={dl} />
      <NameBlock Block={Block} heading={text.bannedMoves} names={bans.moves} localize={localizeMove} dl={dl} />
      <NameBlock Block={Block} heading={text.bannedItems} names={bans.items} localize={localizeItem} dl={dl} />
      <NameBlock Block={Block} heading={text.bannedAbilities} names={bans.abilities} localize={localizeAbility} dl={dl} />
      <NameBlock
        Block={Block}
        heading={text.addedPokemon}
        names={content.addedPokemon}
        localize={localizeSpecies}
        dl={dl}
        chipClass="px-2 py-0.5 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded text-xs"
      />

      {content.minSharedTypePct > 0 && (
        <Block>
          <h3 className="font-semibold text-sm mb-2">{text.sharedType}</h3>
          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-xs">
            {text.sharedTypeRule}
          </span>
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

/** One list of names under "<heading> (<count>)"; nothing when empty. */
function NameBlock({
  Block,
  heading,
  names,
  localize,
  dl,
  chipClass = CHIP_RED,
}: {
  Block: 'section' | 'div';
  heading: string;
  names: readonly string[];
  localize: (name: string, l: DataLocale) => string;
  dl: DataLocale;
  chipClass?: string;
}) {
  const t = useT(rulesetMessages);
  if (names.length === 0) return null;
  return (
    <Block>
      <h3 className="font-semibold text-sm mb-2">{t('detail.headingWithCount', { heading, count: names.length })}</h3>
      <div className="flex flex-wrap gap-1">
        {names.map((name) => (
          <span key={name} className={chipClass}>
            {localize(name, dl)}
          </span>
        ))}
      </div>
    </Block>
  );
}
