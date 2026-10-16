import type { AvatarConfig, AvatarGender, AvatarLayerKey } from '@/types/avatar';
import manifestData from './manifest-data.json';

// ─── Types ───────────────────────────────────────────────────────

export interface AvatarColorVariant {
  color: string;
  filename: string;
  optionId: string;
}

export interface AvatarStyle {
  id: string;
  label: string;
  variants: AvatarColorVariant[];
}

export interface AvatarCategory {
  id: AvatarLayerKey;
  label: string;
  required: boolean;
  zIndex: number;
  styles: AvatarStyle[];
}

// ─── Label Helpers ───────────────────────────────────────────────

/** Convert kebab-case to Title Case. */
function toLabel(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Message key of a manifest id (layer key, style id or variant color) in the
 * `avatar/wardrobe` namespace: `-` and any other non-key character become `_`
 * (`t-shirt` -> `t_shirt`). The UI translates through it; the English `label`
 * fields below stay as the fallback and for the API's validation messages.
 */
export function avatarMessageKey(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

/** English label of a variant color (the fallback when `avatar/wardrobe` has no key for it). */
export function avatarColorLabel(color: string): string {
  return color === 'default' ? 'Default' : color.charAt(0).toUpperCase() + color.slice(1);
}

/** Category English labels (the API's validation messages) and metadata. */
const CATEGORY_META: Record<AvatarLayerKey, { label: string; required: boolean; zIndex: number }> = {
  base: { label: 'Skin Tone', required: true, zIndex: 0 },
  bottoms: { label: 'Bottoms', required: true, zIndex: 1 },
  tops: { label: 'Tops', required: true, zIndex: 2 },
  hair: { label: 'Hair', required: true, zIndex: 3 },
  hats: { label: 'Hats & Accessories', required: false, zIndex: 4 },
};

// ─── Build Categories From Manifest Data ─────────────────────────

type ManifestJson = Record<string, Record<string, Record<string, AvatarColorVariant[]>>>;
const data = manifestData as ManifestJson;

/** Build the category list for a given gender from the manifest JSON. */
function buildCategories(gender: AvatarGender): AvatarCategory[] {
  const genderData = data[gender];
  if (!genderData) return [];

  const categoryOrder: AvatarLayerKey[] = ['base', 'bottoms', 'tops', 'hair', 'hats'];

  return categoryOrder
    .filter((catKey) => genderData[catKey])
    .map((catKey) => {
      const meta = CATEGORY_META[catKey];
      const stylesData = genderData[catKey];
      const styles: AvatarStyle[] = Object.entries(stylesData).map(([styleId, variants]) => ({
        id: styleId,
        label: toLabel(styleId),
        variants: variants as AvatarColorVariant[],
      }));

      return {
        id: catKey,
        label: meta.label,
        required: meta.required,
        zIndex: meta.zIndex,
        styles,
      };
    });
}

// ─── Exports ─────────────────────────────────────────────────────

/** Pre-built category arrays per gender. */
export const AVATAR_CATEGORIES_BY_GENDER: Record<AvatarGender, AvatarCategory[]> = {
  male: buildCategories('male'),
  female: buildCategories('female'),
};

/** Get categories for a specific gender (defaults to 'male' if invalid). */
export function getCategories(gender: AvatarGender): AvatarCategory[] {
  return AVATAR_CATEGORIES_BY_GENDER[gender] ?? AVATAR_CATEGORIES_BY_GENDER.male;
}

/** Look up a single category by gender and key. */
export function getCategory(gender: AvatarGender, key: AvatarLayerKey): AvatarCategory | undefined {
  return getCategories(gender).find((c) => c.id === key);
}

/** Find a specific option across all styles in a category. */
export function findOption(
  gender: AvatarGender,
  categoryKey: AvatarLayerKey,
  optionId: string
): { style: AvatarStyle; variant: AvatarColorVariant } | undefined {
  const cat = getCategory(gender, categoryKey);
  if (!cat) return undefined;
  for (const style of cat.styles) {
    const variant = style.variants.find((v) => v.optionId === optionId);
    if (variant) return { style, variant };
  }
  return undefined;
}

/** Validate that all required layers are present and all IDs are valid. */
export function validateAvatarConfig(config: Partial<AvatarConfig>): string[] {
  const errors: string[] = [];
  if (!config.gender || !['male', 'female'].includes(config.gender)) {
    errors.push('Missing or invalid gender');
    return errors;
  }
  const categories = getCategories(config.gender);
  for (const cat of categories) {
    const value = config[cat.id as keyof AvatarConfig] as string | null | undefined;
    if (cat.required && !value) {
      errors.push(`Missing required layer: ${cat.label}`);
      continue;
    }
    if (value) {
      const found = findOption(config.gender, cat.id, value);
      if (!found) {
        errors.push(`Invalid option "${value}" for ${cat.label}`);
      }
    }
  }
  return errors;
}

/** Get the default avatar config for a given gender (first option of each required layer). */
export function getDefaultAvatarConfig(gender: AvatarGender = 'male'): AvatarConfig {
  const categories = getCategories(gender);
  const config: Record<string, string | null> = { gender };
  for (const cat of categories) {
    if (cat.styles.length > 0 && cat.styles[0].variants.length > 0) {
      config[cat.id] = cat.required ? cat.styles[0].variants[0].optionId : null;
    } else {
      config[cat.id] = null;
    }
  }
  return config as unknown as AvatarConfig;
}

/** Build the asset URL for a given gender, category, and option filename. */
export function getAvatarAssetUrl(gender: AvatarGender, category: AvatarLayerKey, filename: string): string {
  return `/avatar/${gender}/${category}/${filename}`;
}
