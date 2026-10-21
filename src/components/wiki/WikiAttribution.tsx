import { getT } from '@/i18n/server';
import { pkmnMessages } from '@/i18n/messages/pkmn';

/**
 * Footer credit for the German Pokémon names and game texts (PokeAPI, BSD-3-Clause clause 2; pkmn-l10n
 * `src/lib/pkmn/i18n/NOTICE.md`). Server component: rendered by the `/wiki` layout and the Pokémon page.
 */
export default async function WikiAttribution() {
  const t = await getT(pkmnMessages);
  return (
    <footer className="mt-10 border-t border-poke-border pt-3">
      <p className="font-body text-[11px] text-poke-text-muted">{t('attribution')}</p>
    </footer>
  );
}
