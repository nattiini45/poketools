import { describe, expect, it } from 'vitest';
import {
  blockHeight,
  blockWidth,
  compileFacade,
  HAUSSMANN,
  mansardSpec,
  planBlock,
  plazaBlockPlans,
} from '../haussmann';
import { PLAZA } from '../layout';

describe('Haussmann grammar', () => {
  it('keeps bay and floor dimensions in metres', () => {
    expect(HAUSSMANN.bayWidth).toBeGreaterThan(2);
    expect(HAUSSMANN.floorHeight).toBeGreaterThan(3);
    expect(HAUSSMANN.podiumHeight).toBeGreaterThan(HAUSSMANN.floorHeight);
    expect(HAUSSMANN.recessDepth).toBeGreaterThan(0.15);
    expect(HAUSSMANN.mansardSlope).toBeGreaterThan(0.4);
  });

  it('plans windows only on exposed, unreserved bays', () => {
    const [north] = plazaBlockPlans(PLAZA.half);
    const placements = planBlock(north);
    const windows = placements.filter((placement) => placement.module === 'window');
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((window) => Math.abs(window.x) <= blockWidth(north) / 2)).toBe(true);
    expect(windows.every((window) => window.y < blockHeight(north))).toBe(true);
    expect(windows.every((window) => window.recess === HAUSSMANN.recessDepth)).toBe(true);
  });

  it('does not put windows through the reserved jumbotron span', () => {
    const [north] = plazaBlockPlans(PLAZA.half);
    const reservedHalf = ((north.reserved[0].endBay - north.reserved[0].startBay) * HAUSSMANN.bayWidth) / 2;
    const windows = planBlock(north).filter((placement) => placement.module === 'window');
    expect(windows.every((window) => Math.abs(window.x) > reservedHalf - HAUSSMANN.bayWidth)).toBe(
      true,
    );
  });

  it('compiles recessed façade volumes with stone plates', () => {
    const [north] = plazaBlockPlans(PLAZA.half);
    const { plates, windows } = compileFacade(north);
    expect(plates.length).toBeGreaterThan(10);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((window) => window.recess === HAUSSMANN.recessDepth)).toBe(true);
    expect(plates.every((plate) => plate.d > 0.05)).toBe(true);
  });

  it('emits sloped mansard spec when enabled', () => {
    const [north] = plazaBlockPlans(PLAZA.half);
    const spec = mansardSpec(north);
    expect(spec).not.toBeNull();
    expect(spec?.slope).toBe(HAUSSMANN.mansardSlope);
    expect(spec?.rise).toBe(HAUSSMANN.mansardHeight);
    expect(spec?.inset).toBeGreaterThan(0.8);
  });
});
