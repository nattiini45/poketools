/**
 * The dev-only Ruleset Studio preview: the page 404s in production, every scenario is a draft the editor can open (or, for
 * the unreadable one, cannot), and the in-memory library answers save, reload and publish like the real routes do (stale
 * revisions included) without a network.
 */
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { compileDocument } from '@/lib/ruleset-studio/compile.server';
import { normalizeDraft } from '@/lib/ruleset-studio/editor/document';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/server', () => ({
  getI18nProviderProps: async () => ({ locale: 'en', dataLocale: 'en', timeZone: 'UTC', requestTime: 0 }),
}));
vi.mock('../PreviewClient', () => ({ default: () => null }));

import RulesetPreviewPage from '../page';
import PreviewClient from '../PreviewClient';
import { PREVIEW_DEFINITION_ID, PREVIEW_SCENARIOS, buildScenario, presetOf } from '../fixtures';
import { createFakeLibrary, type FakeLibraryState } from '../fake-library';

const original = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;
afterEach(() => {
  env.NODE_ENV = original;
});

function findProps(node: ReactNode): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child);
      if (found !== null) return found;
    }
    return null;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === PreviewClient) return element.props as Record<string, unknown>;
  return findProps(element.props.children);
}

describe('the preview page', () => {
  it('404s in production', async () => {
    env.NODE_ENV = 'production';
    await expect(RulesetPreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('opens the default scenario with the base preset resolved, and follows ?scenario=', async () => {
    env.NODE_ENV = 'development';
    const tree = await RulesetPreviewPage({ searchParams: Promise.resolve({}) });
    const editor = findProps(tree)?.editor as { initialPreset: { id: string } | null; definitionId: string };
    expect(editor.definitionId).toBe(PREVIEW_DEFINITION_ID);
    expect(editor.initialPreset?.id).toBe('gen9ou');
    const blank = findProps(await RulesetPreviewPage({ searchParams: Promise.resolve({ scenario: 'blank' }) }))?.editor as { initialPreset: unknown };
    expect(blank.initialPreset).toBeNull();
    const unknown = findProps(await RulesetPreviewPage({ searchParams: Promise.resolve({ scenario: 'nope' }) }))?.editor as { initialPreset: { id: string } | null };
    expect(unknown.initialPreset?.id).toBe('gen9ou');
  });
});

describe('the scenarios', () => {
  it('every scenario but the unreadable one is a draft the editor opens', () => {
    for (const id of PREVIEW_SCENARIOS) {
      const scenario = buildScenario(id);
      expect(normalizeDraft(scenario.document).ok, id).toBe(id !== 'unreadable');
    }
  });

  it('the edited and published ones compile cleanly with their preset; the issues one has errors and a warning', () => {
    for (const id of ['ou-edited', 'published', 'allowlist', 'roster', 'gen3', 'blank'] as const) {
      const { result } = compileDocument(buildScenario(id).document);
      expect(result.diagnostics.filter((d) => d.severity === 'error'), id).toEqual([]);
    }
    const codes = compileDocument(buildScenario('issues').document).result.diagnostics.map((d) => d.code);
    for (const code of ['duplicate_entry', 'entry_in_ban_and_unban', 'unknown_clause', 'clause_in_add_and_remove', 'allowlist_empty', 'ban_redundant', 'unban_not_banned', 'unknown_entry']) {
      expect(codes, code).toContain(code);
    }
  });

  it('names the preset of a preset draft and none for the others', () => {
    expect(presetOf(buildScenario('roster'))).toBe('gen9championsdraft');
    expect(presetOf(buildScenario('gen3'))).toBe('gen3ou');
    expect(presetOf(buildScenario('blank'))).toBeNull();
    expect(presetOf(buildScenario('unreadable'))).toBeNull();
  });
});

describe('the in-memory library', () => {
  let state: FakeLibraryState;
  const passthrough = vi.fn(async () => new Response('{"success":true,"data":"real"}'));
  const call = (path: string, init?: RequestInit) => createFakeLibrary(state, passthrough as unknown as typeof fetch)(path, init);
  const base = `/api/ruleset-definitions/${PREVIEW_DEFINITION_ID}`;

  beforeEach(() => {
    state = { definitionId: PREVIEW_DEFINITION_ID, rev: 4, document: { a: 1 }, versions: 0 };
    passthrough.mockClear();
  });

  it('passes every other path through to the real fetch', async () => {
    const res = await call('/api/pkmn/catalog/species?gen=9');
    expect((await res.json()).data).toBe('real');
    expect(passthrough).toHaveBeenCalledTimes(1);
  });

  it('saves a draft at the current revision and moves the revision on', async () => {
    const res = await call(`${base}/draft`, { method: 'PUT', body: JSON.stringify({ draft_rev: 4, document: { b: 2 } }) });
    const body = await res.json();
    expect(body.data.draft_rev).toBe(5);
    expect(state.document).toEqual({ b: 2 });
  });

  it('answers a stale revision with the real conflict code and the revision it holds', async () => {
    const res = await call(`${base}/draft`, { method: 'PUT', body: JSON.stringify({ draft_rev: 3, document: {} }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'ruleset_stale_revision', params: { draft_rev: 4 } });
  });

  it('reads the draft back and numbers the published versions', async () => {
    const detail = await (await call(base)).json();
    expect(detail.data.draft).toEqual({ document: { a: 1 }, draft_rev: 4 });
    const first = await (await call(`${base}/publish`, { method: 'POST', body: JSON.stringify({ draft_rev: 4 }) })).json();
    const second = await (await call(`${base}/publish`, { method: 'POST', body: JSON.stringify({ draft_rev: 4 }) })).json();
    expect([first.data.version.version_no, second.data.version.version_no]).toEqual([1, 2]);
  });

  it('refuses anything else like an admin without access', async () => {
    const res = await call('/api/ruleset-definitions', { method: 'POST', body: '{}' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });
});
