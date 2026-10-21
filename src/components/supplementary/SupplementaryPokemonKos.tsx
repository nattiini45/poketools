import { getT } from '@/i18n/server';
import { supplementaryRecordsMessages } from '@/i18n/messages/supplementary-records';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';

/**
 * A species' all-time supplementary KO total on the Pokémon page (docs/format-packs.md, "Pack
 * extensions"), shown beside the live statistics and never added to them. Renders nothing (and
 * runs nothing) without a provider, when supplementary records do not count for this viewer, or
 * when the species has none; a failed read says so.
 */
export default async function SupplementaryPokemonKos({ species }: { species: string }) {
  const provider = packExtensions.supplementaryPokemonKos;
  const result = await loadSupplement(
    'supplementaryPokemonKos',
    provider ? (ctx) => provider(species, ctx) : undefined,
  );
  if (result.state === 'absent' || result.state === 'excluded') return null;
  if (result.state === 'ready' && (result.value === null || result.value.kos <= 0)) return null;

  const t = await getT(supplementaryRecordsMessages);
  return (
    <div className="bg-poke-surface rounded-poke-lg px-4 py-3 shadow-poke-sm border border-poke-border">
      {result.state === 'failed' ? (
        <p role="status" className="text-sm text-poke-text-tertiary">
          {t('loadFailed')}
        </p>
      ) : (
        <>
          <p className="text-sm font-heading font-semibold text-poke-text-primary">
            {t('pokemon.kos', { count: result.value?.kos ?? 0 })}
          </p>
          <p className="text-xs text-poke-text-tertiary">{t('note')}</p>
        </>
      )}
    </div>
  );
}
