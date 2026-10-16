import { notFound } from 'next/navigation';
import { publicReads } from '@/lib/cache/public-reads';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { buildMatchupDexPayload } from '@/lib/evolution/matchup-payload';
import MatchupClient from '@/components/evolution/MatchupClient';
import { getT } from '@/i18n/server';
import { draftLegacyPagesMessages } from '@/i18n/messages/draft/legacy/pages';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Reads no session; rendered per request (dynamic segment, no static params).
// Every read comes from the tagged public read cache (30 s; the season's
// entries are expired by match writes).

export default async function MatchupPage({ params }: PageProps) {
  const { id } = await params;
  const league = await publicReads.season(id);
  if (!league) notFound();
  // Translated after the cached reads; nothing localized enters the cache.
  const t = await getT(draftLegacyPagesMessages);

  const caps = getFormatCapabilities(league.format_type);
  if (!caps.matchupRoles) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-center">
        <p className="text-poke-text-secondary">
          {t('matchup.notAvailable')}
        </p>
      </div>
    );
  }

  const isEpb = league.format_type === 'evolution_point_buy';

  // Public participant rows only (no private player columns are read); the
  // client receives ids and names alone.
  const [participants, trackers, formatRules, teamRoles, pointBuyEntries] = await Promise.all([
    publicReads.seasonParticipants(id),
    isEpb ? publicReads.seasonTrackers(id) : Promise.resolve([]),
    // Disclosed fallback: missing format rules degrade to "no banned moves",
    // and the original error is logged first (never swallowed).
    publicReads.seasonFormatRules(id).catch((err: unknown) => {
      console.error('[leagues/[id]/matchup] getFormatRules failed — no banned moves applied:', err);
      return null;
    }),
    publicReads.teamRoles(),
    isEpb && league.point_buy_list_id
      ? publicReads.pointBuyEntries(league.point_buy_list_id)
      : Promise.resolve([]),
  ]);

  const priceByBase = Object.fromEntries(
    pointBuyEntries.map((e) => [e.base_pokemon, e.price]),
  );

  const dexPayload = isEpb
    ? buildMatchupDexPayload(trackers.map((t) => t.current_form))
    : { typeInfo: {}, speciesDetails: {}, stabMultipliers: {} };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('matchup.title', { league: league.name })}</h1>
        <p className="mt-1 text-sm text-poke-text-secondary">
          {isEpb ? t('matchup.introEpb') : t('matchup.intro')}
        </p>
      </div>

      {isEpb ? (
        <MatchupClient
          seasonId={id}
          formatType={league.format_type}
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          trackers={trackers}
          bannedMoves={formatRules?.banned_moves ?? []}
          initialRoles={teamRoles}
          priceByBase={priceByBase}
          dexPayload={dexPayload}
        />
      ) : (
        <div className="rounded-lg border border-poke-border p-8 text-center text-sm text-poke-text-secondary">
          {t('matchup.unsupported', { count: teamRoles.length })}
        </div>
      )}
    </div>
  );
}
