import { describe, expect, it } from 'vitest';
import { calmRectsFor, selectCalmFaces, writeCalmRects } from '../calm-rects';
import { CALM_RECT_SLOTS, createPaintUniforms } from '../paint-uniforms';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { paddedFaceRect, VIEWPORTS } from '@/lib/route-world/data-surfaces';

describe('calm rects', () => {
  it('selects the active station first, then neighbours, capped at 4 slots', () => {
    const atPulse = selectCalmFaces(PLAZA_DATA_SURFACES, 0);
    expect(atPulse.length).toBeLessThanOrEqual(CALM_RECT_SLOTS);
    expect(atPulse[0].station).toBe('pulse');
    const stations = PLAZA_DATA_SURFACES.stations.map((s) => s.id);
    for (const face of selectCalmFaces(PLAZA_DATA_SURFACES, 2)) {
      expect(Math.abs(stations.indexOf(face.station) - 2)).toBeLessThanOrEqual(1);
    }
  });

  it('projects the padded keep-out rect into GL screen space (bottom-left origin)', () => {
    const face = PLAZA_DATA_SURFACES.faces.find((f) => f.id === 'pulse:board');
    expect(face).toBeDefined();
    if (!face) return;
    const camera = PLAZA_DATA_SURFACES.stations[0].camera;
    const viewport = VIEWPORTS.desktop;
    const [rect] = calmRectsFor([face], camera, viewport);
    const css = paddedFaceRect(face, camera, viewport);
    expect(css).not.toBeNull();
    if (!css) return;
    expect(rect[0]).toBeCloseTo(css.x / viewport.width, 9);
    expect(rect[2]).toBeCloseTo((css.x + css.w) / viewport.width, 9);
    expect(rect[1]).toBeCloseTo(1 - (css.y + css.h) / viewport.height, 9);
    expect(rect[3]).toBeCloseTo(1 - css.y / viewport.height, 9);
    expect(rect[0]).toBeLessThan(rect[2]);
    expect(rect[1]).toBeLessThan(rect[3]);
  });

  it('writes the live count and zeroes unused slots', () => {
    const uniforms = createPaintUniforms();
    writeCalmRects(
      [
        [0.1, 0.2, 0.3, 0.4],
        [0.5, 0.5, 0.6, 0.6],
      ],
      uniforms,
    );
    expect(uniforms.uCalmCount.value).toBe(2);
    expect(uniforms.uCalmRects.value[1].toArray()).toEqual([0.5, 0.5, 0.6, 0.6]);
    expect(uniforms.uCalmRects.value[3].toArray()).toEqual([0, 0, 0, 0]);
    writeCalmRects([], uniforms);
    expect(uniforms.uCalmCount.value).toBe(0);
    expect(uniforms.uCalmRects.value[0].toArray()).toEqual([0, 0, 0, 0]);
  });
});
