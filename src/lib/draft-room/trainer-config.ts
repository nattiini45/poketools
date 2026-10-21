// ── 3D Trainer Avatar Configuration ─────────────────────────────────
// Defines the customizable parts of a trainer's 3D appearance.

export interface TrainerConfig {
  /** Skin tone hex color */
  skinTone: string;
  /** Hair style preset index (0-5) */
  hairStyle: number;
  /** Hair color hex */
  hairColor: string;
  /** Outfit/shirt color hex */
  outfitColor: string;
  /** Pants color hex */
  pantsColor: string;
  /** Hat style index (0 = none, 1-4 = presets) */
  hatStyle: number;
  /** Hat color hex */
  hatColor: string;
  /** Team accent color hex (glow ring, trim) */
  teamColor: string;
}

export const DEFAULT_TRAINER_CONFIG: TrainerConfig = {
  skinTone: '#e8b88a',
  hairStyle: 0,
  hairColor: '#3b2417',
  outfitColor: '#dc2626',
  pantsColor: '#1e3a5f',
  hatStyle: 0,
  hatColor: '#dc2626',
  teamColor: '#a855f7',
};

export const SKIN_TONES = [
  '#fde7c4', '#e8b88a', '#c68642', '#8d5524', '#5c3310', '#3b1f0b',
];

export const HAIR_COLORS = [
  '#3b2417', '#0a0a0a', '#d4a537', '#c0392b', '#8e44ad',
  '#2980b9', '#27ae60', '#ecf0f1', '#e67e22', '#ff69b4',
];

export const OUTFIT_COLORS = [
  '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#4f46e5', '#be185d', '#1e293b', '#f8fafc',
];

/**
 * Hair style ids by preset index (`TrainerConfig.hairStyle`). Labels come from
 * `trainerCreatorMessages.hairStyles.<id>`.
 */
export const HAIR_STYLE_IDS = [
  'short', 'spiky', 'long', 'ponytail', 'buzz', 'mohawk',
] as const;

/**
 * Hat style ids by preset index (`TrainerConfig.hatStyle`, 0 = none). Labels
 * come from `trainerCreatorMessages.hatStyles.<id>`.
 */
export const HAT_STYLE_IDS = [
  'none', 'cap', 'beanie', 'visor', 'topHat',
] as const;

export type HairStyleId = (typeof HAIR_STYLE_IDS)[number];
export type HatStyleId = (typeof HAT_STYLE_IDS)[number];
