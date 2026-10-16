/**
 * The capture harness's docked-panel arm must fail a panel whose body is
 * blank (PR #65 test pass, R4): on the route tier the docked Rulebook opened
 * as a bare title bar — the route-live section rule hid every <section> in
 * it — and the arm passed it with `minFont=18px`, the title's own size.
 */
import { describe, expect, it } from 'vitest';
import { dockedPanelVerdict } from '../lib/w1-evidence.mjs';

const viewport = { w: 1440, h: 900 };
const docked = {
  present: true,
  selector: '.world-focus-panel[open]',
  rect: { x: 1000, y: 16, w: 416, h: 868 },
  viewport,
  fontSizePx: 16,
  minTextFontPx: 18,
  minTextSample: 'Rulebook',
  textNodes: 2,
};

describe('docked panel body', () => {
  it('fails a panel that renders only its title bar', () => {
    const blank = dockedPanelVerdict({ ...docked, bodyTextNodes: 0 });
    expect(blank.verdict).toBe('fail');
    expect(blank.reasons.join(' ')).toMatch(/body renders no visible text/);
    expect(blank.bodyTextNodes).toBe(0);
  });

  it('passes the same panel once its body shows text', () => {
    const full = dockedPanelVerdict({ ...docked, minTextFontPx: 14, textNodes: 14, bodyTextNodes: 12 });
    expect(full.verdict).toBe('pass');
    expect(full.bodyTextNodes).toBe(12);
  });

  it('does not judge an older read that carries no body count', () => {
    expect(dockedPanelVerdict(docked).verdict).toBe('pass');
  });
});
