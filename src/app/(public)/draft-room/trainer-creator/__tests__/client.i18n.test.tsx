/**
 * T18: the trainer creator labels its presets by id (`HAIR_STYLE_IDS` /
 * `HAT_STYLE_IDS`) from the `trainer-creator` namespace.
 */
import { describe, expect, it, vi } from 'vitest';
import { HAIR_STYLE_IDS, HAT_STYLE_IDS } from '@/lib/draft-room/trainer-config';
import { trainerCreatorMessages } from '@/i18n/messages/trainer-creator';
import { renderWithI18n } from '@/test/i18n';

// The 3D preview (react-three-fiber) is client-only and irrelevant here.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import TrainerCreatorClient from '../client';

describe('trainer-creator messages', () => {
  it('label every hair and hat preset id, in index order', () => {
    expect(Object.keys(trainerCreatorMessages.en.hairStyles)).toEqual([...HAIR_STYLE_IDS]);
    expect(Object.keys(trainerCreatorMessages.en.hatStyles)).toEqual([...HAT_STYLE_IDS]);
  });
});

describe('TrainerCreatorClient', () => {
  it('keeps the English labels verbatim', () => {
    const html = renderWithI18n(<TrainerCreatorClient playerId="p1" />);
    expect(html).toContain('Hair Style');
    expect(html).toContain('>Ponytail<');
    expect(html).toContain('>Top Hat<');
    expect(html).toContain('Save Avatar');
  });

  it('renders German labels under the de locale', () => {
    const html = renderWithI18n(<TrainerCreatorClient playerId="p1" />, { locale: 'de' });
    expect(html).toContain('Frisur');
    expect(html).toContain('>Pferdeschwanz<');
    expect(html).toContain('>Zylinder<');
    expect(html).toContain('Team-Akzent');
    expect(html).toContain('Avatar speichern');
  });
});
