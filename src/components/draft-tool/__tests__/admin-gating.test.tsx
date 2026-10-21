/**
 * The room's admin entry (W3, owner feedback 2026-10-18): only pool admins
 * get the Admin button, the admin code loads only through
 * `admin-sheet-loader` (a dynamic import, never for players), the room keeps
 * one snapshot poll, and focus lands on the override switch after "Pick for
 * the active player".
 *
 * Static render (vitest 'node' env) of the real `DraftToolClient` over the
 * `/draft-preview` in-memory backend; `fetch` is never reached.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { buildDraftSearchIndex } from '@/lib/draft-finder/build-index.server';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import { DEFAULT_BANNED_MOVES } from '@/types/format-rules';
import {
  buildPreviewScenario,
  PREVIEW_ENTRIES,
  PREVIEW_LIST_VERSION_ID,
  type PreviewScenarioId,
} from '@/app/(public)/draft-preview/fixtures';
import { createFakeDataSource } from '@/app/(public)/draft-preview/fake-source';

const spies = vi.hoisted(() => ({ load: 0, polls: 0 }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/leagues/s/draft-room',
}));
// The admin chunk: counted, never resolved (a static render shows the Suspense fallback).
vi.mock('../admin-sheet-loader', () => ({
  loadRoomAdminSheet: () => {
    spies.load += 1;
    return new Promise(() => {});
  },
}));
vi.mock('../hooks/use-draft-snapshot', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/use-draft-snapshot')>();
  return {
    ...mod,
    useDraftSnapshot: (...args: Parameters<typeof mod.useDraftSnapshot>) => {
      spies.polls += 1;
      return mod.useDraftSnapshot(...args);
    },
  };
});

import DraftToolClient from '../DraftToolClient';
import { focusAfterAdminSheet } from '../admin-focus';
import AdminSheetBoundary, { AdminSheetLoadFailed, isChunkLoadError } from '../AdminSheetBoundary';

const NOW = Date.UTC(2026, 9, 18, 18, 0, 0);
const LINKS = {
  redraft: '/r',
  tokens: '/t',
  admin: '/admin/leagues/s/draft',
  adminAudit: '/admin/leagues/s/draft/audit',
  trainerCreator: '/c',
};

let index: DraftSearchIndex;
beforeAll(async () => {
  index = (await buildDraftSearchIndex(PREVIEW_LIST_VERSION_ID, PREVIEW_ENTRIES)).index;
}, 60_000);

beforeEach(() => {
  spies.load = 0;
  spies.polls = 0;
});

function renderRoom(id: PreviewScenarioId, locale: 'en' | 'de' = 'en'): string {
  const scenario = buildPreviewScenario(id, NOW);
  const source = createFakeDataSource({ ...scenario.init, index });
  return renderWithI18n(
    <DraftToolClient
      poolId={scenario.poolId}
      seasonId="preview-season"
      leagueName="EvoLiga Preview"
      catalog={buildLineCatalog(PREVIEW_ENTRIES, [], DEFAULT_BANNED_MOVES, locale)}
      initialSnapshot={scenario.init.snapshot}
      indexUrl="preview:list"
      initialIndex={index}
      viewer={scenario.viewer}
      dataSource={source}
      links={LINKS}
      adminActions={source}
      initialAdminTab={scenario.preset?.adminTab}
    />,
    { locale, requestTime: NOW },
  );
}

/** The clock row's Admin button (a dialog trigger). */
const ADMIN_BUTTON = /<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Admin<\/button>/;

describe('Admin button gating', () => {
  it('a player sees no Admin button and loads no admin chunk', () => {
    for (const id of ['live-my-turn', 'live-waiting', 'spectator', 'signed-out'] as const) {
      const html = renderRoom(id);
      expect(html, id).not.toMatch(ADMIN_BUTTON);
      expect(html, id).not.toContain('Admin panel');
    }
    expect(spies.load).toBe(0);
  });

  it('a pool admin sees the Admin button; the chunk still waits for the first open', () => {
    const html = renderRoom('admin-room');
    expect(html).toMatch(ADMIN_BUTTON);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(spies.load).toBe(0);
    expect(renderRoom('admin-room', 'de')).toMatch(ADMIN_BUTTON);
  });

  it('an open sheet requests the chunk (lazy) and keeps the paused banner in the room', () => {
    const html = renderRoom('admin-room-sheet');
    expect(spies.load).toBe(1);
    expect(html).toMatch(/aria-expanded="true"/);
    expect(html).toContain('Draft paused');
    // The chunk is still loading (never resolves here): the room shows the status notice, not a blank.
    expect(html).toContain('Loading the admin controls');
  });

  it('a failed chunk load leaves the room running with a notice and Try again (en + de)', () => {
    const chunk = Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });
    expect(AdminSheetBoundary.getDerivedStateFromError(chunk)).toEqual({ failed: 'load' });
    const en = renderWithI18n(<AdminSheetLoadFailed onRetry={() => {}} onDismiss={() => {}} />, { locale: 'en' });
    expect(en).toContain('role="alert"');
    expect(en).toContain('The admin controls could not be loaded.');
    expect(en).toContain('Try again');
    expect(en).not.toContain('poke-danger');
    const de = renderWithI18n(<AdminSheetLoadFailed onRetry={() => {}} onDismiss={() => {}} />, { locale: 'de' });
    expect(de).toContain('Erneut versuchen');
  });

  it('a runtime error of the loaded sheet gets its own wording (not "could not be loaded"), en + de', () => {
    expect(AdminSheetBoundary.getDerivedStateFromError(new TypeError('x is undefined'))).toEqual({ failed: 'crash' });
    const en = renderWithI18n(<AdminSheetLoadFailed failure="crash" onRetry={() => {}} onDismiss={() => {}} />, { locale: 'en' });
    expect(en).toContain('The admin controls ran into an error.');
    expect(en).not.toContain('could not be loaded');
    expect(en).toContain('Try again');
    const de = renderWithI18n(<AdminSheetLoadFailed failure="crash" onRetry={() => {}} onDismiss={() => {}} />, { locale: 'de' });
    expect(de).toContain('In der Admin-Steuerung ist ein Fehler aufgetreten.');
  });

  it('isChunkLoadError recognises the bundler and browser chunk failures only', () => {
    expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk app_components_draft-admin failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/_next/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'vm')"))).toBe(false);
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(false);
  });

  it('the hover/focus prefetch logs a failed chunk instead of leaving an unhandled rejection', () => {
    const src = readFileSync(resolve(__dirname, '../DraftToolClient.tsx'), 'utf8');
    expect(src).toMatch(/loadRoomAdminSheet\(\)\.catch\(\(error: unknown\) => \{\s*console\.error\('\[draft-room\] admin sheet prefetch failed', error\);/);
    expect(src).not.toMatch(/void loadRoomAdminSheet\(\)/);
  });

  it('nothing under draft-tool imports draft-admin at runtime (type imports and the loader only)', () => {
    const dir = resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(dir);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (!line.includes('draft-admin')) continue;
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        const typeOnly = /^\s*import type /.test(line);
        const loader = file.endsWith('admin-sheet-loader.ts') && /return import\('@\/components\/draft-admin\/RoomAdminSheet'\)/.test(line);
        expect(typeOnly || loader, `${file}: ${line.trim()}`).toBe(true);
      }
    }
  });
});

describe('the room itself', () => {
  // Scope: the room's own snapshot hook only. The lazy sheet never renders here (its mocked loader never
  // resolves), so this says nothing about the sheet; the single-poller guard for the sheet is the throwing
  // `useDraftSnapshot` mock in room-admin-sheet.test.tsx.
  it('runs the same number of snapshot hooks for a pool admin as for a player', () => {
    renderRoom('live-waiting');
    const player = spies.polls;
    spies.polls = 0;
    renderRoom('admin-room-sheet');
    expect(spies.polls).toBe(player);
  });
});

describe('focus after the sheet closes', () => {
  it('after "Pick for the active player" the override switch takes the focus (once)', () => {
    const event = { preventDefault: vi.fn() };
    const focus = vi.fn();
    const pending = { current: true };
    focusAfterAdminSheet(event, pending, { focus });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(pending.current).toBe(false);
    focusAfterAdminSheet(event, pending, { focus });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('any other close leaves Radix to return the focus to the Admin button', () => {
    const event = { preventDefault: vi.fn() };
    focusAfterAdminSheet(event, { current: false }, { focus: vi.fn() });
    expect(event.preventDefault).not.toHaveBeenCalled();
    const pending = { current: true };
    focusAfterAdminSheet(event, pending, null);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(pending.current).toBe(false);
  });
});
