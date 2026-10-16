import { describe, it, expect } from 'vitest';
import {
  getCategories,
  getCategory,
  findOption,
  validateAvatarConfig,
  getDefaultAvatarConfig,
  getAvatarAssetUrl,
  avatarColorLabel,
  avatarMessageKey,
  AVATAR_CATEGORIES_BY_GENDER,
} from '../manifest';
import { avatarWardrobeMessages } from '@/i18n/messages/avatar/wardrobe';
import { createTranslator } from '@/i18n/core';

// ─── Tests ─────────────────────────────────────────────────────────

describe('AVATAR_CATEGORIES_BY_GENDER', () => {
  it('has entries for male and female', () => {
    expect(AVATAR_CATEGORIES_BY_GENDER.male).toBeDefined();
    expect(AVATAR_CATEGORIES_BY_GENDER.female).toBeDefined();
  });

  it('male categories follow expected order', () => {
    const ids = AVATAR_CATEGORIES_BY_GENDER.male.map((c) => c.id);
    // Should contain base, bottoms, tops, hair (hats optional depending on manifest data)
    expect(ids).toContain('base');
    expect(ids).toContain('bottoms');
    expect(ids).toContain('tops');
    expect(ids).toContain('hair');
  });

  it('categories have correct metadata', () => {
    const base = AVATAR_CATEGORIES_BY_GENDER.male.find((c) => c.id === 'base');
    if (base) {
      expect(base.label).toBe('Skin Tone');
      expect(base.required).toBe(true);
      expect(base.zIndex).toBe(0);
    }
  });
});

describe('getCategories', () => {
  it('returns male categories', () => {
    const cats = getCategories('male');
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toBe(AVATAR_CATEGORIES_BY_GENDER.male);
  });

  it('returns female categories', () => {
    const cats = getCategories('female');
    expect(cats).toBe(AVATAR_CATEGORIES_BY_GENDER.female);
  });
});

describe('getCategory', () => {
  it('returns specific category by key', () => {
    const cat = getCategory('male', 'hair');
    if (cat) {
      expect(cat.id).toBe('hair');
      expect(cat.label).toBe('Hair');
    }
  });

  it('returns undefined for non-existent category', () => {
    const cat = getCategory('male', 'wings' as never);
    expect(cat).toBeUndefined();
  });
});

describe('findOption', () => {
  it('finds an existing option', () => {
    const cats = getCategories('male');
    // Use first available option from first category
    const firstCat = cats[0];
    if (firstCat?.styles.length > 0 && firstCat.styles[0].variants.length > 0) {
      const optionId = firstCat.styles[0].variants[0].optionId;
      const found = findOption('male', firstCat.id, optionId);
      expect(found).toBeDefined();
      expect(found!.variant.optionId).toBe(optionId);
      expect(found!.style.id).toBe(firstCat.styles[0].id);
    }
  });

  it('returns undefined for non-existent option', () => {
    const found = findOption('male', 'base', 'non-existent-option-id');
    expect(found).toBeUndefined();
  });

  it('returns undefined for non-existent category', () => {
    const found = findOption('male', 'wings' as never, 'anything');
    expect(found).toBeUndefined();
  });
});

describe('validateAvatarConfig', () => {
  it('returns error for missing gender', () => {
    const errors = validateAvatarConfig({});
    expect(errors).toContain('Missing or invalid gender');
  });

  it('returns error for invalid gender', () => {
    const errors = validateAvatarConfig({ gender: 'other' as never });
    expect(errors).toContain('Missing or invalid gender');
  });

  it('returns errors for missing required layers', () => {
    const errors = validateAvatarConfig({ gender: 'male' });
    // Should have errors for each required layer
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('Missing required layer'))).toBe(true);
  });

  it('returns no errors for valid default config', () => {
    const config = getDefaultAvatarConfig('male');
    const errors = validateAvatarConfig(config);
    expect(errors).toEqual([]);
  });

  it('returns error for invalid option ID', () => {
    const config = getDefaultAvatarConfig('male');
    // Replace a valid option with an invalid one
    config.base = 'invalid-option-id';
    const errors = validateAvatarConfig(config);
    expect(errors.some((e) => e.includes('Invalid option'))).toBe(true);
  });
});

describe('getDefaultAvatarConfig', () => {
  it('returns a complete config for male', () => {
    const config = getDefaultAvatarConfig('male');
    expect(config.gender).toBe('male');
    // Required layers should have values
    expect(config.base).toBeTruthy();
    expect(config.bottoms).toBeTruthy();
    expect(config.tops).toBeTruthy();
    expect(config.hair).toBeTruthy();
  });

  it('returns a complete config for female', () => {
    const config = getDefaultAvatarConfig('female');
    expect(config.gender).toBe('female');
  });

  it('defaults to male when no gender provided', () => {
    const config = getDefaultAvatarConfig();
    expect(config.gender).toBe('male');
  });

  it('optional layers (hats) default to null', () => {
    const config = getDefaultAvatarConfig('male');
    // hats is not required, so should be null by default
    expect(config.hats).toBeNull();
  });
});

describe('getAvatarAssetUrl', () => {
  it('builds correct URL for male base', () => {
    const url = getAvatarAssetUrl('male', 'base', 'skin-light.png');
    expect(url).toBe('/avatar/male/base/skin-light.png');
  });

  it('builds correct URL for female hair', () => {
    const url = getAvatarAssetUrl('female', 'hair', 'long-brown.png');
    expect(url).toBe('/avatar/female/hair/long-brown.png');
  });

  it('builds URL with special characters in filename', () => {
    const url = getAvatarAssetUrl('male', 'tops', 'shirt-v2.png');
    expect(url).toBe('/avatar/male/tops/shirt-v2.png');
  });
});

describe('avatarMessageKey', () => {
  it('turns manifest ids into message keys', () => {
    expect(avatarMessageKey('t-shirt')).toBe('t_shirt');
    expect(avatarMessageKey('jumpsuit-pants-alt')).toBe('jumpsuit_pants_alt');
    expect(avatarMessageKey('hats')).toBe('hats');
  });
});

describe('avatarColorLabel', () => {
  it('capitalises the color and names the default variant', () => {
    expect(avatarColorLabel('default')).toBe('Default');
    expect(avatarColorLabel('navy')).toBe('Navy');
  });
});

describe('avatar/wardrobe messages cover the manifest', () => {
  const allCategories = [...AVATAR_CATEGORIES_BY_GENDER.male, ...AVATAR_CATEGORIES_BY_GENDER.female];
  const { en } = avatarWardrobeMessages;
  const lookup = (group: Record<string, string>, id: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(group, avatarMessageKey(id)) ? group[avatarMessageKey(id)] : undefined;

  it('every category, style and color has an English label equal to the manifest label', () => {
    for (const cat of allCategories) {
      expect(lookup(en.categories, cat.id)).toBe(cat.label);
      for (const style of cat.styles) {
        expect(lookup(en.styles, style.id)).toBe(style.label);
        for (const variant of style.variants) {
          expect(lookup(en.colors, variant.color)).toBe(avatarColorLabel(variant.color));
        }
      }
    }
  });

  it('translates manifest labels into German', () => {
    const t = createTranslator(avatarWardrobeMessages, 'de');
    expect(t('categories.base')).toBe('Hautton');
    expect(t.dynamic(`styles.${avatarMessageKey('t-shirt')}`)).toBe('T-Shirt');
    expect(t('colors.navy')).toBe('Marineblau');
  });

  it('holds no label the manifest does not use', () => {
    const styleKeys = new Set(allCategories.flatMap((c) => c.styles.map((s) => avatarMessageKey(s.id))));
    const colorKeys = new Set(
      allCategories.flatMap((c) => c.styles.flatMap((s) => s.variants.map((v) => avatarMessageKey(v.color)))),
    );
    expect(Object.keys(en.styles).filter((k) => !styleKeys.has(k))).toEqual([]);
    expect(Object.keys(en.colors).filter((k) => !colorKeys.has(k))).toEqual([]);
  });
});
