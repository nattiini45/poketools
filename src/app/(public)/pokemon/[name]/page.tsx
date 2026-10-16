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
import type { PokemonSpeciesInfo, PokemonDetailStats } from '@/types/game';

// Dynamic: the page reads the session (community notes are login-only and
// stay live). The all-time usage block comes from the tagged public read
// cache (60 s, expired by match writes).
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ name: string }>;
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
    <PageContainer title={localizeSpecies(species.name, dataLocale)} subtitle={t('pokemon.subtitle')}>
      {/* Header: Sprite + Types + Base Stats */}
      <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Sprite + Name + Types */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="bg-poke-muted rounded-poke-lg p-3">
              <PokemonSprite name={species.name} size={120} animated />
            </div>
            <div className="flex gap-1.5">
              {speciesInfo.types.map((type) => (
                <TypeBadge key={type} type={type} locale={dataLocale} />
              ))}
            </div>
            {abilities.length > 0 && (
              <div className="text-xs text-poke-text-muted">
                {abilities.map((ability) => localizeAbility(ability, dataLocale)).join(' / ')}
              </div>
            )}
          </div>

          {/* Base Stats */}
          <div className="flex-1">
            <h3 className="text-sm font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
              {t('pokemon.baseStats')}
            </h3>
            <BaseStatBars stats={speciesInfo.baseStats} dataLocale={dataLocale} t={t} />
          </div>
        </div>
      </div>

      {/* Interactive stats section */}
      <PokemonDetailClient
        pokemonName={species.name}
        initialStats={initialStats}
      />

      {/* Abilities & Type Matchups side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Abilities */}
        <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
          <h2 className="font-heading text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
            {t('pokemon.abilities')}
          </h2>
          <div className="space-y-1.5">
            {species.legalAbilities.map((a) => (
              <div key={a.name} className="flex items-center gap-2">
                <span className="font-body text-sm text-poke-text-primary">
                  {localizeAbility(a.name, dataLocale)}
                </span>
                {a.slot === 'H' && (
                  <span className="text-xs text-poke-text-secondary font-body">{t('pokemon.hidden')}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Type Matchups */}
        {typeInfo && (
          <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border space-y-3">
            <h2 className="font-heading text-xs font-semibold text-poke-text-secondary uppercase tracking-wide">
              {t('pokemon.typeMatchups')}
            </h2>

            {typeInfo.weaknesses.length > 0 && (
              <div>
                <h3 className="font-heading text-[11px] font-semibold text-red-400 uppercase mb-1">
                  {t('pokemon.weakTo')}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {typeInfo.weaknesses.map((type) => (
                    <TypeBadge key={type} type={type} locale={dataLocale} />
                  ))}
                </div>
              </div>
            )}

            {typeInfo.resistances.length > 0 && (
              <div>
                <h3 className="font-heading text-[11px] font-semibold text-green-400 uppercase mb-1">
                  {t('pokemon.resists')}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {typeInfo.resistances.map((type) => (
                    <TypeBadge key={type} type={type} locale={dataLocale} />
                  ))}
                </div>
              </div>
            )}

            {typeInfo.immunities.length > 0 && (
              <div>
                <h3 className="font-heading text-[11px] font-semibold text-poke-text-secondary uppercase mb-1">
                  {t('pokemon.immuneTo')}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {typeInfo.immunities.map((type) => (
                    <TypeBadge key={type} type={type} locale={dataLocale} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Battle Usage Stats */}
      <WikiUsageStats pokemonName={species.name} />

      <hr className="border-poke-border" />

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
    <div className="space-y-2">
      {STAT_KEYS.map((key) => {
        const label = localizeStat(key, dataLocale, 'short');
        const value = stats[key];
        const width = getStatBarWidth(value, maxStat); // 0–180 CSS px equivalent
        const cssWidth = Math.min((width / 180) * 100, 100);
        const { background } = getStatBarColor(value, maxStat);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-heading font-medium text-poke-text-muted">{label}</span>
            <span className="w-8 text-xs font-mono text-poke-text-primary text-right">{value}</span>
            <div className="flex-1 h-2.5 bg-poke-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${cssWidth}%`, backgroundColor: background }}
              />
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1 border-t border-poke-border">
        <span className="w-16 shrink-0 text-xs font-heading font-semibold text-poke-text-secondary">{t('pokemon.bst')}</span>
        <span className="text-xs font-mono font-semibold text-poke-text-primary">{total}</span>
      </div>
    </div>
  );
}
