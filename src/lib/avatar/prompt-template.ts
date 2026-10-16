/**
 * AI Avatar prompt template system.
 * Maps user-facing choices to hidden prompt fragments.
 * The composed prompt is NEVER sent to the client.
 */

import type { AiAvatarChoices, AiChoiceCategory_Def } from '@/types/avatar';

// ─── Art-style base prompts (replaces the old single BASE_PROMPT) ────

const STYLE_BASE_PROMPTS: Record<string, string> = {
  anime:
    'Pokemon trainer character portrait, Gen 7 Sun and Moon anime art style, ' +
    'single character centered on clean background, high quality digital art',
  videogame:
    'Pokemon trainer character portrait, 3D video game character render, ' +
    'Pokemon game style, cel-shaded lighting, single character centered on clean background, high quality digital art',
  real:
    'Pokemon trainer character portrait, photorealistic portrait, ' +
    'cinematic lighting, shallow depth of field, detailed, single character centered on clean background',
};

// ─── Prompt Fragments (server-side only — never exposed to client) ────

const GENDER_FRAGMENTS: Record<string, string> = {
  boy: 'male trainer, masculine',
  girl: 'female trainer, feminine',
  neutral: 'androgynous trainer',
};

const HAIR_STYLE_FRAGMENTS: Record<string, string> = {
  short: 'short hair',
  long: 'long flowing hair',
  spiky: 'spiky hair',
  ponytail: 'hair in a ponytail',
  curly: 'curly hair',
  buzz_cut: 'buzz cut hair',
  braids: 'braided hair',
  twin_tails: 'twin tail pigtails',
  messy: 'messy tousled hair',
  mohawk: 'mohawk hairstyle',
  afro: 'afro hairstyle',
  side_part: 'side-parted hair',
};

const HAIR_COLOR_FRAGMENTS: Record<string, string> = {
  black: 'black hair',
  brown: 'brown hair',
  blonde: 'blonde hair',
  red: 'red hair',
  blue: 'blue hair',
  pink: 'pink hair',
  white: 'white hair',
  green: 'green hair',
  purple: 'purple hair',
  silver: 'silver hair',
  orange: 'orange hair',
  teal: 'teal hair',
};

const TOPS_FRAGMENTS: Record<string, string> = {
  trainer_jacket: 'red and white trainer jacket',
  hoodie: 'hoodie with pokeball logo',
  t_shirt: 'casual t-shirt',
  formal_shirt: 'formal button-up shirt with tie',
  tank_top: 'athletic tank top',
  vest: 'utility vest over shirt',
  sweater: 'cozy knit sweater',
  lab_coat: 'professor lab coat',
  kimono: 'traditional kimono top',
  cloak: 'flowing mysterious cloak',
};

const BOTTOMS_FRAGMENTS: Record<string, string> = {
  jeans: 'blue jeans',
  shorts: 'adventure shorts',
  skirt: 'pleated skirt',
  cargo_pants: 'cargo pants with pockets',
  sweatpants: 'comfortable sweatpants',
  leggings: 'fitted leggings',
  dress: 'long flowing dress',
  overalls: 'denim overalls',
};

const EXPRESSION_FRAGMENTS: Record<string, string> = {
  confident: 'confident determined expression',
  friendly: 'warm friendly smile',
  fierce: 'intense battle-ready expression',
  chill: 'relaxed calm expression',
  mysterious: 'mysterious enigmatic look',
  playful: 'playful mischievous grin',
  serious: 'serious focused expression',
  excited: 'excited enthusiastic expression',
};

const ACCESSORY_FRAGMENTS: Record<string, string> = {
  pokeball_cap: 'wearing a pokeball baseball cap',
  glasses: 'wearing stylish glasses',
  scarf: 'wearing a flowing scarf',
  headband: 'wearing a headband',
  goggles: 'wearing goggles on forehead',
  backpack: 'wearing a trainer backpack',
  gloves: 'wearing fingerless gloves',
  earrings: 'wearing earrings',
  necklace: 'wearing a pendant necklace',
  bandana: 'wearing a bandana',
  mask: 'wearing a half-face mask',
  cape: 'wearing a short cape',
  watch: 'wearing a poketch watch',
  satchel: 'carrying a leather satchel',
  none: '',
};

const BACKGROUND_FRAGMENTS: Record<string, string> = {
  adventure_trail: 'outdoor pokemon journey backdrop, winding trail',
  battle_arena: 'pokemon battle arena, dramatic energy',
  pokemon_forest: 'lush pokemon forest setting, dappled sunlight',
  city_street: 'pokemon city streetscape, modern buildings',
  beach_sunset: 'tropical beach at sunset, warm golden light',
  mountain_peak: 'dramatic mountain peak, clouds below',
  pokemon_center: 'inside a pokemon center, warm interior lighting',
  gym_interior: 'pokemon gym interior, arena floor',
  night_sky: 'starry night sky backdrop, moonlight',
  rainy_day: 'rainy day atmosphere, reflective puddles',
  snow_field: 'snowy landscape, gentle snowfall',
  cherry_blossoms: 'cherry blossom trees, petals falling',
};

// ─── All fragment maps keyed by category ────

const FRAGMENT_MAPS: Record<string, Record<string, string>> = {
  gender: GENDER_FRAGMENTS,
  hair_style: HAIR_STYLE_FRAGMENTS,
  hair_color: HAIR_COLOR_FRAGMENTS,
  tops: TOPS_FRAGMENTS,
  bottoms: BOTTOMS_FRAGMENTS,
  expression: EXPRESSION_FRAGMENTS,
  accessory: ACCESSORY_FRAGMENTS,
  background: BACKGROUND_FRAGMENTS,
  // art_style is handled via STYLE_BASE_PROMPTS, not as a fragment
};

// ─── User-facing choice definitions (NO prompt text — just labels) ────

export const AI_CHOICE_CATEGORIES: AiChoiceCategory_Def[] = [
  {
    id: 'art_style',
    label: 'Art Style',
    options: [
      { id: 'anime', label: 'Anime' },
      { id: 'videogame', label: 'Videogame' },
      { id: 'real', label: 'Realistic' },
    ],
  },
  {
    id: 'gender',
    label: 'Trainer Style',
    options: [
      { id: 'boy', label: 'Boy' },
      { id: 'girl', label: 'Girl' },
      { id: 'neutral', label: 'Neutral' },
    ],
  },
  {
    id: 'hair_style',
    label: 'Hair Style',
    options: [
      { id: 'short', label: 'Short' },
      { id: 'long', label: 'Long' },
      { id: 'spiky', label: 'Spiky' },
      { id: 'ponytail', label: 'Ponytail' },
      { id: 'curly', label: 'Curly' },
      { id: 'buzz_cut', label: 'Buzz Cut' },
      { id: 'braids', label: 'Braids' },
      { id: 'twin_tails', label: 'Twin Tails' },
      { id: 'messy', label: 'Messy' },
      { id: 'mohawk', label: 'Mohawk' },
      { id: 'afro', label: 'Afro' },
      { id: 'side_part', label: 'Side Part' },
    ],
  },
  {
    id: 'hair_color',
    label: 'Hair Color',
    options: [
      { id: 'black', label: 'Black' },
      { id: 'brown', label: 'Brown' },
      { id: 'blonde', label: 'Blonde' },
      { id: 'red', label: 'Red' },
      { id: 'blue', label: 'Blue' },
      { id: 'pink', label: 'Pink' },
      { id: 'white', label: 'White' },
      { id: 'green', label: 'Green' },
      { id: 'purple', label: 'Purple' },
      { id: 'silver', label: 'Silver' },
      { id: 'orange', label: 'Orange' },
      { id: 'teal', label: 'Teal' },
    ],
  },
  {
    id: 'tops',
    label: 'Top',
    options: [
      { id: 'trainer_jacket', label: 'Trainer Jacket' },
      { id: 'hoodie', label: 'Hoodie' },
      { id: 't_shirt', label: 'T-Shirt' },
      { id: 'formal_shirt', label: 'Formal Shirt' },
      { id: 'tank_top', label: 'Tank Top' },
      { id: 'vest', label: 'Vest' },
      { id: 'sweater', label: 'Sweater' },
      { id: 'lab_coat', label: 'Lab Coat' },
      { id: 'kimono', label: 'Kimono' },
      { id: 'cloak', label: 'Cloak' },
    ],
  },
  {
    id: 'bottoms',
    label: 'Bottoms',
    options: [
      { id: 'jeans', label: 'Jeans' },
      { id: 'shorts', label: 'Shorts' },
      { id: 'skirt', label: 'Skirt' },
      { id: 'cargo_pants', label: 'Cargo Pants' },
      { id: 'sweatpants', label: 'Sweatpants' },
      { id: 'leggings', label: 'Leggings' },
      { id: 'dress', label: 'Dress' },
      { id: 'overalls', label: 'Overalls' },
    ],
  },
  {
    id: 'expression',
    label: 'Vibe',
    options: [
      { id: 'confident', label: 'Confident' },
      { id: 'friendly', label: 'Friendly' },
      { id: 'fierce', label: 'Fierce' },
      { id: 'chill', label: 'Chill' },
      { id: 'mysterious', label: 'Mysterious' },
      { id: 'playful', label: 'Playful' },
      { id: 'serious', label: 'Serious' },
      { id: 'excited', label: 'Excited' },
    ],
  },
  {
    id: 'accessory',
    label: 'Accessory',
    options: [
      { id: 'pokeball_cap', label: 'Poke Ball Cap' },
      { id: 'glasses', label: 'Glasses' },
      { id: 'scarf', label: 'Scarf' },
      { id: 'headband', label: 'Headband' },
      { id: 'goggles', label: 'Goggles' },
      { id: 'backpack', label: 'Backpack' },
      { id: 'gloves', label: 'Gloves' },
      { id: 'earrings', label: 'Earrings' },
      { id: 'necklace', label: 'Necklace' },
      { id: 'bandana', label: 'Bandana' },
      { id: 'mask', label: 'Mask' },
      { id: 'cape', label: 'Cape' },
      { id: 'watch', label: 'Poketch Watch' },
      { id: 'satchel', label: 'Satchel' },
      { id: 'none', label: 'None' },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    options: [
      { id: 'adventure_trail', label: 'Adventure Trail' },
      { id: 'battle_arena', label: 'Battle Arena' },
      { id: 'pokemon_forest', label: 'Pokemon Forest' },
      { id: 'city_street', label: 'City Street' },
      { id: 'beach_sunset', label: 'Beach Sunset' },
      { id: 'mountain_peak', label: 'Mountain Peak' },
      { id: 'pokemon_center', label: 'Pokemon Center' },
      { id: 'gym_interior', label: 'Gym Interior' },
      { id: 'night_sky', label: 'Night Sky' },
      { id: 'rainy_day', label: 'Rainy Day' },
      { id: 'snow_field', label: 'Snow Field' },
      { id: 'cherry_blossoms', label: 'Cherry Blossoms' },
    ],
  },
];

/**
 * Compose the full T2I prompt from user choices. Server-side only.
 * The art_style choice selects the base prompt; all other choices append fragments.
 */
export function composePrompt(choices: AiAvatarChoices): string {
  const styleKey = choices.art_style || 'anime';
  const base = STYLE_BASE_PROMPTS[styleKey] || STYLE_BASE_PROMPTS.anime;
  const fragments: string[] = [base];

  for (const [category, choiceId] of Object.entries(choices)) {
    if (category === 'art_style') continue; // already handled via base prompt
    const map = FRAGMENT_MAPS[category];
    if (!map) continue;
    const fragment = map[choiceId];
    if (fragment) fragments.push(fragment);
  }

  return fragments.join(', ');
}

/**
 * Validate that all choice IDs are valid against known categories.
 * Returns error messages for invalid choices, or empty array if valid.
 */
export function validateChoices(choices: AiAvatarChoices): string[] {
  const errors: string[] = [];
  for (const cat of AI_CHOICE_CATEGORIES) {
    const value = choices[cat.id];
    if (!value) {
      errors.push(`Missing choice: ${cat.label}`);
      continue;
    }
    if (!cat.options.some((opt) => opt.id === value)) {
      errors.push(`Invalid choice "${value}" for ${cat.label}`);
    }
  }
  return errors;
}

/**
 * Get default choices (first option in each category).
 */
export function getDefaultAiChoices(): AiAvatarChoices {
  const choices: Record<string, string> = {};
  for (const cat of AI_CHOICE_CATEGORIES) {
    choices[cat.id] = cat.options[0].id;
  }
  return choices as unknown as AiAvatarChoices;
}
