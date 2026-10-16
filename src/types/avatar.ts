/** Gender options for the avatar system. */
export type AvatarGender = 'male' | 'female';

/** Layer categories for the paper-doll avatar system, in compositing z-order. */
export type AvatarLayerKey = 'base' | 'bottoms' | 'tops' | 'hair' | 'hats';

/** Stored layer selections — maps each category to the selected option ID. */
export interface AvatarConfig {
  gender: AvatarGender;
  base: string;
  bottoms: string;
  tops: string;
  hair: string;
  hats: string | null;
}

/** The compositing z-order for layers (back to front). */
export const AVATAR_LAYER_ORDER: AvatarLayerKey[] = [
  'base',
  'bottoms',
  'tops',
  'hair',
  'hats',
];

/** Base canvas size for avatar assets. The sprites are 160x160. */
export const AVATAR_BASE_SIZE = 160;

// ─── AI Avatar Generation Types ────────────────────────────────

/** Choice category keys for the AI avatar generator (9 categories). */
export type AiChoiceCategory =
  | 'gender'
  | 'hair_style'
  | 'hair_color'
  | 'tops'
  | 'bottoms'
  | 'expression'
  | 'accessory'
  | 'background'
  | 'art_style';

/** User-facing choice selections sent to the server. The server maps these to prompt fragments. */
export interface AiAvatarChoices {
  gender: string;
  hair_style: string;
  hair_color: string;
  tops: string;
  bottoms: string;
  expression: string;
  accessory: string;
  background: string;
  art_style: string;
}

// ─── AI Avatar Gallery Types ────────────────────────────────

export interface PhotoTransformGalleryChoices {
  type: 'photo_transform';
}

export type AvatarGalleryChoices = AiAvatarChoices | PhotoTransformGalleryChoices;

/** A saved AI avatar generation in the personal/community gallery. */
export interface AiGalleryItem {
  id: string;
  player_id: string;
  image_url: string;
  choices: AvatarGalleryChoices;
  style: string;
  created_at: string;
  /** Present on community items — the player's display name. */
  player_name?: string;
}

/** A single selectable option shown to the user (prompt fragment is server-side only). */
export interface AiChoiceOption {
  id: string;
  label: string;
}

/** A choice category with its user-facing label and options. */
export interface AiChoiceCategory_Def {
  id: AiChoiceCategory;
  label: string;
  options: AiChoiceOption[];
}

/** Max AI avatar generations per player per rolling 24h window. */
export const AI_AVATAR_DAILY_LIMIT = 10;
