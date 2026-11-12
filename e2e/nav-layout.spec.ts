import { expect, test } from './support/fixtures';

const WIDTHS = [1024, 1280, 1344, 1400, 1440, 1536, 1600, 1707, 1792, 1920];

test.describe('site nav layout', () => {
  for (const width of WIDTHS) {
    test(`no two nav controls overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const nav = page.locator('#site-nav');
      await expect(nav).toBeVisible();
      const boxes = await nav.evaluate((el) =>
        [...el.querySelectorAll('a, button')]
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { label: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          })
          .filter((b) => b.right - b.left > 0 && b.bottom - b.top > 0),
      );
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          expect(overlap, `"${a.label}" overlaps "${b.label}"`).toBe(false);
        }
      }
    });
  }
});
