import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpriteStyleProvider } from '@/components/shared/SpriteStyleProvider';
import { buildFixtureCatalog } from '@/lib/draft-finder/__tests__/fixture-index';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { renderWithI18n, withI18n } from '@/test/i18n';
import CostConsequence, { RemainingAfterPick } from '../left/CostConsequence';
import LinePreview from '../left/LinePreview';
import StageStatus from '../left/StageStatus';
import styles from '../draft-tool.module.css';

/**
 * The left stage's pieces (WP-E): the group portrait of the line, the budget line above DRAFT and the
 * status strip. The CSS contract of the portrait is asserted on the stylesheet text, because the node
 * tests have no layout engine.
 */
const catalog = buildFixtureCatalog();
const threeStage = catalog.lines.find((l) => l.lineId === 'oshawott--samurott') as DraftLineCatalogEntry;
const twoStage: DraftLineCatalogEntry = {
  ...threeStage,
  lineId: 'oshawott--dewott',
  stages: threeStage.stages.slice(0, 2),
  thresholds: { ...threeStage.thresholds, additionalToStage3: null },
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CSS = readFileSync(path.resolve(__dirname, '../draft-tool.module.css'), 'utf8');

/** The declaration block of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const m = new RegExp(`(?:^|\\n)${esc(selector)} \\{([^}]*)\\}`).exec(CSS);
  expect(m, `rule ${selector}`).not.toBeNull();
  return m?.[1] ?? '';
}

describe('LinePreview', () => {
  it('renders the stages of a three-stage line once, in evolution order, base on top of the stack', () => {
    const html = renderWithI18n(<LinePreview entry={threeStage} />);
    expect(html.split(styles.previewStage)).toHaveLength(2);
    expect(html).toContain('data-stages="3"');
    const slots = [...html.matchAll(/<li [^>]*data-slot="(\d)"[^>]*style="z-index:(\d)"[^>]*><img alt="([^"]+)"/g)].map((m) => [m[1], m[2], m[3]]);
    expect(slots).toEqual([
      ['0', '3', 'Oshawott'],
      ['1', '2', 'Dewott'],
      ['2', '1', 'Samurott'],
    ]);
  });

  it('renders a two-stage line as two slots, with no empty third one', () => {
    const html = renderWithI18n(<LinePreview entry={twoStage} />);
    expect(html).toContain('data-stages="2"');
    expect([...html.matchAll(/data-slot="(\d)"/g)].map((m) => m[1])).toEqual(['0', '1']);
    expect([...html.matchAll(/<img alt="([^"]+)"/g)].map((m) => m[1])).toEqual(['Oshawott', 'Dewott']);
  });

  it('localizes the sprites’ alt text and loads the large asset sized by CSS, not by the attributes', () => {
    const html = renderWithI18n(<LinePreview entry={threeStage} />, { locale: 'de' });
    expect(html).toMatch(/<img alt="[^"]+"[^>]* width="256" height="256"[^>]* class="[^"]*previewImg/);
  });

  it('marks the pixel style for crisp scaling and nothing else', () => {
    const plain = renderWithI18n(<LinePreview entry={threeStage} />);
    expect(plain).not.toContain(styles.previewPixel);
    const pixel = renderToStaticMarkup(
      withI18n(
        <SpriteStyleProvider initialPreference="pixel">
          <LinePreview entry={threeStage} />
        </SpriteStyleProvider>,
      ),
    );
    expect(pixel).toContain(styles.previewPixel);
    const home = renderToStaticMarkup(
      withI18n(
        <SpriteStyleProvider initialPreference="home">
          <LinePreview entry={threeStage} />
        </SpriteStyleProvider>,
      ),
    );
    expect(home).not.toContain(styles.previewPixel);
    expect(rule('.previewPixel .previewImg')).toMatch(/image-rendering: pixelated;/);
  });

  it('sizes the picture from the pane width: a size container, container units, no pixel sizes', () => {
    expect(rule('.previewStage')).toMatch(/container-type: inline-size;/);
    const slots = [...CSS.matchAll(/\.previewStage\[data-stages="(\d)"\] > \.previewSlot\[data-slot="(\d)"\] \{([^}]*)\}/g)];
    // Three slots for a three-stage line, two for a pair.
    expect(slots.map((m) => `${m[1]}:${m[2]}`)).toEqual(['3:0', '3:1', '3:2', '2:0', '2:1']);
    for (const [, , , body] of slots) {
      expect(body).toMatch(/left: [\d.]+cqi;/);
      expect(body).toMatch(/top: [\d.]+cqi;/);
      expect(body).toMatch(/width: [\d.]+cqi;/);
      expect(body).not.toMatch(/\d(?:px|rem)\b/);
    }
  });

  it('ascends left to right: each later stage is larger, further right and higher', () => {
    const px = (stages: string, slot: string, prop: 'left' | 'top' | 'width') => {
      const body = new RegExp(String.raw`data-stages="${stages}"\] > \.previewSlot\[data-slot="${slot}"\] \{([^}]*)\}`).exec(CSS)?.[1] ?? '';
      return Number(new RegExp(`${prop}: ([\\d.]+)cqi`).exec(body)?.[1]);
    };
    for (const [stages, count] of [['3', 3], ['2', 2]] as const) {
      for (let i = 1; i < count; i += 1) {
        const prev = String(i - 1);
        const next = String(i);
        expect(px(stages, next, 'width')).toBeGreaterThan(px(stages, prev, 'width'));
        expect(px(stages, next, 'left')).toBeGreaterThan(px(stages, prev, 'left'));
        expect(px(stages, next, 'top')).toBeLessThan(px(stages, prev, 'top'));
      }
    }
    // The final stage takes about half of the pane or more; the slots overlap but stay inside the stage.
    expect(px('3', '2', 'width')).toBeGreaterThanOrEqual(50);
    expect(px('2', '1', 'width')).toBeGreaterThanOrEqual(50);
    for (const [stages, slot] of [['3', '0'], ['3', '1'], ['3', '2'], ['2', '0'], ['2', '1']] as const) {
      expect(px(stages, slot, 'left') + px(stages, slot, 'width')).toBeLessThanOrEqual(100);
      expect(px(stages, slot, 'top') + px(stages, slot, 'width')).toBeLessThanOrEqual(82);
    }
    expect(px('3', '1', 'left')).toBeLessThan(px('3', '0', 'left') + px('3', '0', 'width'));
    expect(px('3', '2', 'left')).toBeLessThan(px('3', '1', 'left') + px('3', '1', 'width'));
  });

  it('keeps the shared phone/desktop switches for the clock bar, but the stage uses neither', () => {
    expect(CSS).toMatch(/\n\.wideOnly \{/);
    expect(CSS).toMatch(/\n\.phoneOnly \{/);
    expect(CSS).not.toMatch(/previewCompact|previewS[123]/);
  });
});

describe('CostConsequence', () => {
  const vm = { activeSlot: null, participants: [] } as never;

  it('shows the budget left after the pick and never the price', () => {
    const html = renderWithI18n(<CostConsequence remainingAfter={130} reason={null} vm={vm} />);
    expect(html).toContain('Remaining after pick: 130 P');
    expect(html).toContain(styles.dockRemaining);
    expect(html).not.toMatch(/text-2xl|font-extrabold/);
  });

  it('names the player when an admin picks on their behalf (EN and DE)', () => {
    const en = renderWithI18n(<CostConsequence remainingAfter={96} forPlayer="Dawn" reason={null} vm={vm} />);
    expect(en).toContain('Remaining for Dawn after pick: 96 P');
    expect(en).not.toContain('Remaining after pick');
    const de = renderWithI18n(<CostConsequence remainingAfter={96} forPlayer="Dawn" reason={null} vm={vm} />, { locale: 'de' });
    expect(de).toContain('Restbudget von Dawn nach dem Pick: 96 P');
  });

  it('turns the figure into the warning ink when the budget would go negative', () => {
    const html = renderWithI18n(<RemainingAfterPick remaining={-4} />);
    expect(html).toContain('text-[var(--draft-warn-ink)]');
    expect(html).toContain('Remaining after pick: -4 P');
    expect(renderWithI18n(<RemainingAfterPick remaining={4} />)).not.toContain('--draft-warn-ink');
  });

  it('renders nothing for a spectator without a verdict', () => {
    expect(renderWithI18n(<CostConsequence remainingAfter={null} reason={null} vm={vm} />)).toBe('');
  });

  it('hides its budget line on phones, where the bottom bar carries it', () => {
    const phone = /@media \(max-width: 767px\) \{[\s\S]*?\.stageCta,\s*\.dockRemaining \{\s*display: none;\s*\}/;
    expect(CSS).toMatch(phone);
  });
});

describe('StageStatus', () => {
  it('renders nothing when the connection is fine and the viewer takes part', () => {
    expect(renderWithI18n(<StageStatus stale={false} spectator={null} />)).toBe('');
  });

  it('shows one slim strip with an icon and a line per state, without bordered boxes', () => {
    const html = renderWithI18n(<StageStatus stale spectator="guest" />);
    expect(html.match(/<svg /g)).toHaveLength(2);
    expect(html).toContain('Connection lost');
    expect(html).toContain('You are watching as a guest');
    expect(html).toMatch(/<a [^>]*href="\/auth\/signin"[^>]*>Sign in<\/a>/);
    expect(html).not.toMatch(/\bborder\b|rounded-lg/);
    expect(html).toMatch(/<p role="status"/);
  });

  it('says a signed-in non-participant is only watching, with no sign-in link', () => {
    const html = renderWithI18n(<StageStatus stale={false} spectator="nonParticipant" />);
    expect(html).toContain('You are not taking part in this league and are watching only.');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('role="status"');
  });
});
