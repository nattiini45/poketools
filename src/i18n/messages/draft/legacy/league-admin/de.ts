import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  tier: '{tier}-Tier',
  pokemonCount: { one: '{count} Pokémon', other: '{count} Pokémon' },
});
