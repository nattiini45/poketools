/**
 * T19 (i18n-core §11.3): the world registry's nav labels follow the viewer.
 * Every registry section carries a `navKey` into `world/client`
 * `nav.worlds.<worldId>.<sectionId>`, whose English value is the section's
 * own `navLabel` (the fallback) and whose German value is the plaza's
 * reviewed wording. `WorldNav` translates the key; this pins the data.
 */
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { getDefaultWorld, getWorldByRouteThemeId, resolveWorld } from '@/lib/worlds/registry';
import type { SeasonWorld } from '@/lib/worlds/types';

const en = createTranslator(worldClientMessages, 'en');
const de = createTranslator(worldClientMessages, 'de');

function allWorlds(): SeasonWorld[] {
  const themed = ['plaza', 'sakura', 'mountain', 'clouds'].map((id) => getWorldByRouteThemeId(id));
  // An unregistered pin falls back to the DOM-only default world.
  const fallback = resolveWorld({ format_type: 'singles', route_theme: 'nonexistent' as never });
  return [...themed.filter((world): world is SeasonWorld => world !== null), fallback, getDefaultWorld()];
}

describe('registry nav labels (T19)', () => {
  it('every section has a key whose English label is its navLabel', () => {
    for (const world of allWorlds()) {
      for (const section of world.sections) {
        expect(section.navKey).toBe(`${world.id}.${section.id}`);
        expect(en.has(`nav.worlds.${section.navKey}`)).toBe(true);
        expect(en.dynamic(`nav.worlds.${section.navKey}`)).toBe(section.navLabel);
      }
    }
  });

  it('the plaza keeps its reviewed German labels for a German viewer, English for an English one', () => {
    const plaza = getWorldByRouteThemeId('plaza');
    expect(plaza).not.toBeNull();
    const labels = (t: typeof en) => plaza!.sections.map((section) => t.dynamic(`nav.worlds.${section.navKey}`));
    // The line list is the Point-Buy-Liste, never "Kaderliste".
    expect(labels(de)).toEqual(['Puls', 'Point-Buy-Liste', 'Teams', 'Spielplan', 'Regelwerk']);
    expect(labels(en)).toEqual(['Pulse', 'Point-Buy list', 'Teams', 'Schedule', 'Rules']);
  });

  it('the isle worlds read the same German labels as the plaza', () => {
    for (const id of ['sakura', 'mountain', 'clouds']) {
      const world = getWorldByRouteThemeId(id);
      expect(world?.sections.map((section) => de.dynamic(`nav.worlds.${section.navKey}`))).toEqual([
        'Puls',
        'Point-Buy-Liste',
        'Teams',
        'Spielplan',
        'Regelwerk',
      ]);
    }
  });
});
