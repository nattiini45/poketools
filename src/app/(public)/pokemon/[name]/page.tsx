import type { Metadata } from 'next';
import { speciesMetadata } from '@/lib/seo/wiki-metadata';
import { notFound } from 'next/navigation';
import { getStatBarColor, getStatBarWidth } from '@/lib/pkmn/stat-calc';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale, StatKey } from '@/lib/pkmn/i18n/types';
import { getSession } from '@/lib/auth/helpers';
import { publicReads } from '@/lib/cache/public-reads';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { getWikiSpeciesDetail } from '@/lib/wiki/index-rows.server';
import { getDataLocale, getT } from '@/i18n/server';
import type { Translator } from '@/i18n/core';
import { wikiMessages } from '@/i18n/messages/wiki';
import PageContainer from '@/components/ui/PageContainer';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import PokemonDetailClient from './PokemonDetailClient';
import WikiAttribution from '@/components/wiki/WikiAttribution';
import WikiUsageStats from '@/components/wiki/WikiUsageStats';
import WikiNotesSection from '@/components/wiki/WikiNotesSection';
import WikiHeader from '@/components/wiki/WikiHeader';
import WikiLinkList from '@/components/wiki/WikiLinkList';
import { WikiHero, WikiSection } from '@/components/wiki/WikiParts';
import SupplementaryPokemonKos from '@/components/supplementary/SupplementaryPokemonKos';
import type { PokemonSpeciesInfo, PokemonDetailStats } from '@/types/game';

// Dynamic: the page reads the session (community notes are login-only and
// stay live). The all-time usage block comes from the tagged public read
// cache (60 s, expired by match writes).
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  return speciesMetadata(decodeURIComponent(name));
}

export default async function PokemonDetailPage({ params }: PageProps) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  // Locale-neutral species data from the bounded module memo (English names, numbers).
  const species = getWikiSpeciesDetail(decodedName);

  if (!species) notFound();

  const { typeInfo, abilities } = species;

  const speciesInfo: PokemonSpeciesInfo = {
    name: species.name,
    types: species.types,
    baseStats: { ...species.baseStats },
    abilities,
  };

  const [session, t, dataLocale] = await Promise.all([getSession(), getT(wikiMessages), getDataLocale()]);

  // Fetch default all_time stats + wiki content (notes only when logged in)
  const [aggregate, totalGames, notes] = await Promise.all([
    publicReads.pokemonAggregate(species.name),
    publicReads.totalGames('all_time', null),
    session
      ? getApprovedNotes('pokemon', species.name).catch(() => [])
      : Promise.resolve([]),
  ]);

  const initialStats: PokemonDetailStats = aggregate
    ? {
        pokemon_name: species.name,
        total_appearances: aggregate.total_appearances,
        total_games_in_scope: totalGames,
        usage_percent: totalGames > 0 ? (aggregate.total_appearances / totalGames) * 100 : 0,
        kos_dealt: aggregate.total_kos_dealt,
        koed_rate: aggregate.total_appearances > 0
          ? (aggregate.total_koed / aggregate.total_appearances) * 100
          : 0,
        bring_rate: aggregate.total_games > 0
          ? (aggregate.total_brought / aggregate.total_games) * 100
          : null,
        lead_rate: aggregate.total_games > 0
          ? (aggregate.total_led / aggregate.total_games) * 100
          : null,
        win_rate: aggregate.total_appearances > 0
          ? (aggregate.total_wins / aggregate.total_appearances) * 100
          : null,
        moves: Object.entries(aggregate.move_counts)
          .map(([moveName, count]) => ({
            name: moveName,
            count,
            usage_percent: aggregate.total_appearances > 0
              ? (count / aggregate.total_appearances) * 100
              : 0,
          }))
          .sort((a, b) => b.count - a.count),
        items: [],
        players: [],
      }
    : {
        pokemon_name: species.name,
        total_appearances: 0,
        total_games_in_scope: totalGames,
        usage_percent: 0,
        kos_dealt: 0,
        koed_rate: 0,
        bring_rate: null,
        lead_rate: null,
        win_rate: null,
        moves: [],
        items: [],
        players: [],
      };

  return (
    <PageContainer>
      <WikiHeader />

      {/* Hero: sprite, name, types and base stats on the arena sand */}
      <WikiHero>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center lg:gap-10">
          <div className="flex flex-col items-center gap-5 sm:flex-row lg:gap-6">
            <div className="skew-plate h-52 w-56 shrink-0">
              <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-surface" />
              <span aria-hidden="true" className="skew-plate-underside" />
              <PokemonSprite name={species.name} size={176} animated />
            </div>
            <div className="flex min-w-0 flex-col items-center gap-3 text-center sm:items-start sm:text-left">
              <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">
                {localizeSpecies(species.name, dataLocale)}
              </h1>
              <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {speciesInfo.types.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
              {abilities.length > 0 && (
                <p className="text-caption text-fg-muted">
                  {abilities.map((ability) => localizeAbility(ability, dataLocale)).join(' / ')}
                </p>
              )}
            </div>
          </div>

          {/* Base Stats */}
          <div className="min-w-0">
            <h2 className="mb-3 font-heading text-title text-fg">{t('pokemon.baseStats')}</h2>
            <BaseStatBars stats={speciesInfo.baseStats} dataLocale={dataLocale} t={t} />
          </div>
        </div>
      </WikiHero>

      {/* Abilities & Type Matchups side by side */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Abilities */}
        <WikiSection title={t('pokemon.abilities')}>
          <WikiLinkList
            items={species.legalAbilities.map((a) => ({
              key: a.name,
              href: `/wiki/abilities/${encodeURIComponent(a.name)}`,
              label: localizeAbility(a.name, dataLocale),
              meta: a.slot === 'H' ? t('pokemon.hidden') : undefined,
            }))}
          />
        </WikiSection>

        {/* Type Matchups */}
        {typeInfo && (
          <WikiSection title={t('pokemon.typeMatchups')}>
            <dl className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
              {(
                [
                  ['weak', t('pokemon.weakTo'), 'text-loss', typeInfo.weaknesses],
                  ['resists', t('pokemon.resists'), 'text-win', typeInfo.resistances],
                  ['immune', t('pokemon.immuneTo'), 'text-fg-muted', typeInfo.immunities],
                ] as const
              ).map(
                ([key, label, tone, types]) =>
                  types.length > 0 && (
                    <div
                      key={key}
                      className="grid gap-2 border-b border-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-4"
                    >
                      <dt className={`text-caption font-[550] ${tone}`}>{label}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {types.map((type) => (
                          <TypeBadge key={type} type={type} locale={dataLocale} />
                        ))}
                      </dd>
                    </div>
                  ),
              )}
            </dl>
          </WikiSection>
        )}
      </div>

      {/* Interactive stats section */}
      <WikiSection title={t('pokemon.subtitle')} icon="scope-lens">
        <PokemonDetailClient pokemonName={species.name} initialStats={initialStats} />
      </WikiSection>

      {/* Pack extensions (docs/format-packs.md): nothing without a provider. */}
      <SupplementaryPokemonKos species={species.name} />

      {/* Battle Usage Stats */}
      <WikiUsageStats pokemonName={species.name} />

      <WikiNotesSection
        entityType="pokemon"
        entityName={species.name}
        notes={notes}
        unauthenticated={!session}
      />

      <WikiAttribution />
    </PageContainer>
  );
}

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function BaseStatBars({
  stats,
  dataLocale,
  t,
}: {
  stats: PokemonSpeciesInfo['baseStats'];
  dataLocale: DataLocale;
  t: Translator<typeof wikiMessages.en>;
}) {
  const maxStat = 255;
  const total = Object.values(stats).reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col gap-2">
      {STAT_KEYS.map((key) => {
        const label = localizeStat(key, dataLocale, 'short');
        const value = stats[key];
        const width = getStatBarWidth(value, maxStat); // 0–180 CSS px equivalent
        const cssWidth = Math.min((width / 180) * 100, 100);
        const { background } = getStatBarColor(value, maxStat);
        return (
          <div key={key} className="grid grid-cols-[3rem_2.25rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-caption font-[550] text-fg-muted">{label}</span>
            <span className="text-right font-mono text-body tabular-nums text-fg">{value}</span>
            <div className="h-3 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full" style={{ width: `${cssWidth}%`, backgroundColor: background }} />
            </div>
          </div>
        );
      })}
      <div className="mt-1 grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-2 border-t border-hairline-strong pt-2">
        <span className="text-caption font-[550] text-fg-muted">{t('pokemon.bst')}</span>
        <span className="font-heading text-title tabular-nums text-fg">{total}</span>
      </div>
    </div>
  );
}
