import { describe, it, expect } from 'vitest';

import {
  composePrompt,
  validateChoices,
  getDefaultAiChoices,
  AI_CHOICE_CATEGORIES,
} from '../prompt-template';
import type { AiAvatarChoices } from '@/types/avatar';

function makeChoices(overrides?: Partial<AiAvatarChoices>): AiAvatarChoices {
  return {
    art_style: 'anime',
    gender: 'boy',
    hair_style: 'short',
    hair_color: 'black',
    tops: 'trainer_jacket',
    bottoms: 'jeans',
    expression: 'confident',
    accessory: 'pokeball_cap',
    background: 'adventure_trail',
    ...overrides,
  };
}

describe('AI_CHOICE_CATEGORIES', () => {
  it('has 9 categories', () => {
    expect(AI_CHOICE_CATEGORIES).toHaveLength(9);
  });

  it('includes expected category IDs', () => {
    const ids = AI_CHOICE_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('art_style');
    expect(ids).toContain('gender');
    expect(ids).toContain('hair_style');
    expect(ids).toContain('hair_color');
    expect(ids).toContain('tops');
    expect(ids).toContain('bottoms');
    expect(ids).toContain('expression');
    expect(ids).toContain('accessory');
    expect(ids).toContain('background');
  });

  it('each category has at least one option', () => {
    for (const cat of AI_CHOICE_CATEGORIES) {
      expect(cat.options.length).toBeGreaterThan(0);
    }
  });

  it('each option has a non-empty id and label', () => {
    for (const cat of AI_CHOICE_CATEGORIES) {
      for (const opt of cat.options) {
        expect(opt.id).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    }
  });
});

describe('composePrompt', () => {
  it('starts with the anime base prompt by default', () => {
    const prompt = composePrompt(makeChoices());
    expect(prompt).toContain('Pokemon trainer character portrait');
    expect(prompt).toContain('anime art style');
  });

  it('uses videogame base prompt when art_style is videogame', () => {
    const prompt = composePrompt(makeChoices({ art_style: 'videogame' }));
    expect(prompt).toContain('3D video game character render');
  });

  it('uses realistic base prompt when art_style is real', () => {
    const prompt = composePrompt(makeChoices({ art_style: 'real' }));
    expect(prompt).toContain('photorealistic portrait');
  });

  it('falls back to anime when art_style is unknown', () => {
    const prompt = composePrompt(makeChoices({ art_style: 'unknown_style' }));
    expect(prompt).toContain('anime art style');
  });

  it('falls back to anime when art_style is empty', () => {
    const prompt = composePrompt(makeChoices({ art_style: '' }));
    expect(prompt).toContain('anime art style');
  });

  it('includes gender fragment', () => {
    const prompt = composePrompt(makeChoices({ gender: 'girl' }));
    expect(prompt).toContain('female trainer, feminine');
  });

  it('includes hair style fragment', () => {
    const prompt = composePrompt(makeChoices({ hair_style: 'ponytail' }));
    expect(prompt).toContain('hair in a ponytail');
  });

  it('includes hair color fragment', () => {
    const prompt = composePrompt(makeChoices({ hair_color: 'blue' }));
    expect(prompt).toContain('blue hair');
  });

  it('includes tops fragment', () => {
    const prompt = composePrompt(makeChoices({ tops: 'hoodie' }));
    expect(prompt).toContain('hoodie with pokeball logo');
  });

  it('includes bottoms fragment', () => {
    const prompt = composePrompt(makeChoices({ bottoms: 'shorts' }));
    expect(prompt).toContain('adventure shorts');
  });

  it('includes expression fragment', () => {
    const prompt = composePrompt(makeChoices({ expression: 'fierce' }));
    expect(prompt).toContain('intense battle-ready expression');
  });

  it('includes accessory fragment', () => {
    const prompt = composePrompt(makeChoices({ accessory: 'glasses' }));
    expect(prompt).toContain('wearing stylish glasses');
  });

  it('omits empty fragment for accessory=none', () => {
    const prompt = composePrompt(makeChoices({ accessory: 'none' }));
    // The 'none' accessory has an empty string fragment, so it should not add trailing comma
    expect(prompt).not.toContain(', ,');
  });

  it('includes background fragment', () => {
    const prompt = composePrompt(makeChoices({ background: 'beach_sunset' }));
    expect(prompt).toContain('tropical beach at sunset');
  });

  it('joins all fragments with commas', () => {
    const prompt = composePrompt(makeChoices());
    const parts = prompt.split(', ');
    // At minimum: base prompt + gender + hair_style + hair_color + tops + bottoms + expression + accessory + background
    expect(parts.length).toBeGreaterThanOrEqual(9);
  });

  it('ignores unknown categories in choices', () => {
    const choices = {
      ...makeChoices(),
      unknown_category: 'value',
    } as unknown as AiAvatarChoices;

    // Should not throw
    const prompt = composePrompt(choices);
    expect(prompt).toBeTruthy();
  });
});

describe('validateChoices', () => {
  it('returns empty array for valid choices', () => {
    const errors = validateChoices(makeChoices());
    expect(errors).toEqual([]);
  });

  it('returns error for each missing choice', () => {
    const errors = validateChoices({} as AiAvatarChoices);
    expect(errors).toHaveLength(9); // One for each category
    for (const err of errors) {
      expect(err).toMatch(/Missing choice:/);
    }
  });

  it('returns error for invalid choice value', () => {
    const errors = validateChoices(makeChoices({ gender: 'invalid_gender' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Invalid choice "invalid_gender"');
    expect(errors[0]).toContain('Trainer Style');
  });

  it('catches multiple validation errors at once', () => {
    const choices = makeChoices({
      gender: 'bad_gender',
      hair_color: 'neon_rainbow',
    });
    const errors = validateChoices(choices);
    expect(errors).toHaveLength(2);
  });

  it('treats empty string as missing', () => {
    const errors = validateChoices(makeChoices({ art_style: '' }));
    // Empty string is falsy, so it should be "Missing choice"
    expect(errors.some((e) => e.includes('Missing choice: Art Style'))).toBe(true);
  });
});

describe('getDefaultAiChoices', () => {
  it('returns choices for all 9 categories', () => {
    const defaults = getDefaultAiChoices();
    const keys = Object.keys(defaults);
    expect(keys).toHaveLength(9);
  });

  it('picks the first option in each category', () => {
    const defaults = getDefaultAiChoices();
    for (const cat of AI_CHOICE_CATEGORIES) {
      expect(defaults[cat.id]).toBe(cat.options[0].id);
    }
  });

  it('produces valid choices per validateChoices', () => {
    const defaults = getDefaultAiChoices();
    const errors = validateChoices(defaults);
    expect(errors).toEqual([]);
  });

  it('default choices produce a valid prompt', () => {
    const defaults = getDefaultAiChoices();
    const prompt = composePrompt(defaults);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(50);
  });
});
