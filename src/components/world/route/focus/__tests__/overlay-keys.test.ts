import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasOverlayKey, ROSTER_BOARD_VALUE } from '../overlay-keys';

const HERE = join(fileURLToPath(import.meta.url), '..');

/**
 * PR #63 review (critical) — `OverlaySwitch` picks its content by a search
 * param value (`?rules=…`, `?team=…`), which is untrusted URL input. The old
 * `value in contents` check also matched prototype-chain keys, so a crafted
 * param (`constructor`, `toString`, `__proto__`) passed membership and handed
 * React an inherited function as a child — a client render crash reachable
 * from a shareable link. Membership must be own-property only.
 */
describe('hasOverlayKey — own-property membership for URL-driven overlay keys', () => {
  const contents: Record<string, unknown> = { rules: 'rules-node', team: 'team-node' };

  it('accepts registered own keys', () => {
    expect(hasOverlayKey(contents, 'rules')).toBe(true);
    expect(hasOverlayKey(contents, 'team')).toBe(true);
  });

  it('rejects every Object.prototype key a crafted ?param= could carry', () => {
    // Derived, not hand-enumerated: a literal list silently misses engine
    // additions (the four accessor keys were missing) and a security test
    // whose title overstates its enumeration invites trust (PR #63 review).
    const prototypeKeys = Object.getOwnPropertyNames(Object.prototype);
    expect(prototypeKeys).toContain('constructor');
    expect(prototypeKeys).toContain('__proto__');
    for (const key of prototypeKeys) {
      expect(hasOverlayKey(contents, key)).toBe(false);
    }
  });

  it('rejects unknown keys and keys inherited from a custom prototype', () => {
    expect(hasOverlayKey(contents, 'nope')).toBe(false);
    expect(hasOverlayKey(contents, '')).toBe(false);

    const withProto = Object.create({ inherited: 'node' }) as Record<string, unknown>;
    withProto.own = 'node';
    expect(hasOverlayKey(withProto, 'inherited')).toBe(false);
    expect(hasOverlayKey(withProto, 'own')).toBe(true);
  });

  it('accepts own keys that shadow prototype names (author-defined content wins)', () => {
    const authored = { toString: 'a legitimately authored overlay' };
    expect(hasOverlayKey(authored, 'toString')).toBe(true);
  });
});

/**
 * The helper tests above stay green if a CALL SITE reverts to `value in
 * contents`, which is the whole vulnerability — so pin the call site too.
 * There is no DOM test environment here (`environment: 'node'`, no
 * @testing-library), so the guard reads the source, the same shape as
 * `scripts/check-safe-error-response.mjs`.
 */
describe('OverlaySwitch — the URL-driven lookups stay behind the helper', () => {
  const source = readFileSync(join(HERE, '..', 'OverlaySwitch.tsx'), 'utf8');

  it('guards both the content and the title lookup with own-property membership', () => {
    // W6: the live value AND the value retained for a docked exit both pass
    // the own-property guard before any lookup.
    expect(source).toContain('const live = value && hasOverlayKey(contents, value) ? value : null;');
    expect(source).toContain('if (!shown || !hasOverlayKey(contents, shown)) return null;');
    expect(source).toContain("hasOverlayKey(titles, shown) ? titles[shown] : ''");
  });
});

/**
 * Fidelity wave 2 (2D): `?board=roster` opens the full roster list in every
 * world. The value is one more OWN key on the board map, so it passes the
 * same guard — and a crafted `?board=__proto__` still opens nothing.
 */
describe('hasOverlayKey — the ?board=roster value', () => {
  const board: Record<string, unknown> = {
    pulse: 'pulse-node',
    schedule: 'schedule-node',
    [ROSTER_BOARD_VALUE]: 'roster-node',
  };

  it('is the literal `roster` (the value subjects and the Station Card write)', () => {
    expect(ROSTER_BOARD_VALUE).toBe('roster');
  });

  it('accepts roster beside pulse and schedule', () => {
    expect(hasOverlayKey(board, 'roster')).toBe(true);
    expect(hasOverlayKey(board, 'pulse')).toBe(true);
    expect(hasOverlayKey(board, 'schedule')).toBe(true);
  });

  it('rejects __proto__ and every other prototype key on the roster-bearing map', () => {
    expect(hasOverlayKey(board, '__proto__')).toBe(false);
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      expect(hasOverlayKey(board, key)).toBe(false);
    }
    // Near-misses of the value never open it.
    expect(hasOverlayKey(board, 'Roster')).toBe(false);
    expect(hasOverlayKey(board, 'roster ')).toBe(false);
  });

  it('a map literal written with a `__proto__` key does not register it', () => {
    // Object-literal `__proto__:` sets the prototype, it is not an own key —
    // so even a careless author entry cannot make the param answer.
    const crafted = { __proto__: { roster: 'inherited' } } as unknown as Record<string, unknown>;
    expect(hasOverlayKey(crafted, 'roster')).toBe(false);
    expect(hasOverlayKey(crafted, '__proto__')).toBe(false);
  });
});

/**
 * Both overlay builders and all three roster tap targets use the shared
 * constant — a subject writing a value no map answers would open nothing.
 */
describe('?board=roster — the maps and the tap targets agree', () => {
  const read = (...parts: string[]) => readFileSync(join(HERE, '..', '..', '..', ...parts), 'utf8');

  it('both overlay builders register the roster board value', () => {
    expect(read('evoliga', 'EvoligaOverlays.tsx')).toContain('boardContents[ROSTER_BOARD_VALUE] =');
    expect(read('sections', 'overlays', 'ThemeOverlays.tsx')).toContain(
      'board.contents[ROSTER_BOARD_VALUE] =',
    );
  });

  it('the plaza kiosk, sakura wall and mountain lodge open it', () => {
    expect(read('evoliga', 'route', 'plaza', 'CenterDesk.tsx')).toContain(
      "{ param: 'board', value: ROSTER_BOARD_VALUE }",
    );
    for (const file of [
      ['themes', 'sakura', 'furniture', 'RosterShrine.tsx'],
      ['themes', 'mountain', 'furniture', 'TrailRegister.tsx'],
    ]) {
      const source = read(...file);
      expect(source).toContain("const ROSTER_PANEL: SubjectPanel = { param: 'board', value: ROSTER_BOARD_VALUE };");
      expect(source).toContain('panel={ROSTER_PANEL}');
    }
  });
});
