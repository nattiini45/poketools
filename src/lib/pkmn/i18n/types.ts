/**
 * Types of the Pokémon data localization layer (design pkmn-l10n.md §3.2). Type-only: no runtime code.
 *
 * The data locale is CORE's `Locale` (critique S1): this layer declares no cookie, provider or toggle; it reads
 * the locale through `useDataLocale()` (`@/i18n/client`) or `getDataLocale()` / `getRequestDataLocale()`
 * (`@/i18n/server`).
 */
import type { Locale } from '@/i18n/config';
import type { PkmnNameKind } from '@/i18n/pkmn-seam';

/** The locale Pokémon names render in: the UI locale, or 'en' with "Keep Pokémon terms in English". */
export type DataLocale = Locale;

/** The entity kinds that have a generated German name map. */
export type PkmnKind = Extract<PkmnNameKind, 'species' | 'move' | 'item' | 'ability' | 'type' | 'nature'>;

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatusKey = 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
export type WeatherKey = 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Hail' | 'Harsh Sunshine' | 'Heavy Rain' | 'Strong Winds';
export type TerrainKey = 'Electric' | 'Grassy' | 'Misty' | 'Psychic';
export type MoveCategory = 'Physical' | 'Special' | 'Status';
