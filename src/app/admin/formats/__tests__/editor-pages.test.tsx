/**
 * The stored-format routes: `/admin/formats/[id]` (read-only) and `/admin/formats/[id]/edit` (the editor). The gate
 * is the real `gateFormatDefinition` over mocked auth and reads: a malformed id is a 404 before anything is read, a
 * non-admin gets the guard, an admin who may not see the format the forbidden notice, a viewer who may not edit is
 * sent to the read-only page, and the editor's props carry no owner id and no player row.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { ltext } from '@/lib/studio-core/ltext';
import { presetDoc } from '@/components/format-studio/__tests__/editor/test-helpers';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  getFormatDefinitionMeta: vi.fn(),
  getFormatDetail: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: mocks.getFormatDefinitionMeta }));
vi.mock('@/lib/format-studio/library', () => ({ getFormatDetail: mocks.getFormatDetail }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('@/components/format-studio/editor/FormatEditor', () => stub('FormatEditor'));
vi.mock('@/components/format-studio/FormatDetail', () => stub('FormatDetail'));
vi.mock('@/components/format-studio/starts/ForkStoredButton', () => stub('ForkStoredButton'));

import EditPage from '../[id]/edit/page';
import DetailPage from '../[id]/page';
import Loading from '../[id]/edit/loading';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import FormatEditor from '@/components/format-studio/editor/FormatEditor';
import FormatDetail from '@/components/format-studio/FormatDetail';
import ForkStoredButton from '@/components/format-studio/starts/ForkStoredButton';

const ID = '33333333-3333-4333-8333-333333333333';

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean; playerId?: string }) {
  const { playerId = 'p1', ...rest } = flags;
  return { player: { playerId, isAdmin: flags.isSiteAdmin === true, name: 'Alex', discord_id: 'secret' }, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...rest };
}

function meta(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    slug: 'my-cup',
    name: ltext('en', 'My cup', 'Mein Pokal'),
    description: null,
    kind: 'custom',
    owner_id: 'p1',
    visibility: 'private',
    forked_from: null,
    draft_rev: 3,
    current_version_id: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    definition: {
      id: ID,
      slug: 'my-cup',
      name: ltext('en', 'My cup', 'Mein Pokal'),
      description: null,
      kind: 'custom',
      visibility: 'private',
      forked_from: null,
      draft_rev: 3,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
      owner: { id: 'p1', name: 'Alex' },
      current_version: null,
    },
    draft: { document: presetDoc(), draft_rev: 3 },
    published: null,
    versions: [],
    check: null,
    // What `loadRulesetChoices` answers: a definition by its own id, and the legacy id a stored document still names.
    rulesets: [
      { id: 'rs1', name: 'OU Singles', version_no: 3 },
      { id: 'legacy-rs1', name: 'OU Singles', version_no: 3, definition_id: 'rs1' },
    ],
    ...over,
  };
}

const published = () => ({
  id: 'v1',
  version_no: 2,
  schema_version: 1,
  content_hash: 'hash-2',
  changelog: null,
  created_by: 'p1',
  created_at: '2026-10-02T10:00:00Z',
  spec: presetDoc('cup'),
});

function findByType(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (isValidElement<{ children?: ReactNode }>(n)) {
      if (n.type === type) found.push(n as ReactElement<Record<string, unknown>>);
      visit(n.props.children);
    }
  };
  visit(node);
  return found;
}

const html = (tree: ReactNode, locale: Locale = mocks.locale) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} dataLocale={locale} timeZone="UTC" requestTime={0}>
      {tree}
    </I18nProvider>,
  );

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const reads = () => [mocks.getFormatDefinitionMeta, mocks.getFormatDetail];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
  mocks.getFormatDefinitionMeta.mockResolvedValue(meta());
  mocks.getFormatDetail.mockResolvedValue(detail());
});

describe.each([
  ['edit page', (id: string) => EditPage(params(id))],
  ['read-only page', (id: string) => DetailPage(params(id))],
])('%s: the gate', (_name, call) => {
  it('a malformed id is a 404 before any auth or data read', async () => {
    await expect(call('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    for (const read of reads()) expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin flag without a player', { ...access({ isAnyAdmin: true }), player: null }],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await call(ID);
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, FormatEditor)).toHaveLength(0);
    expect(findByType(tree, FormatDetail)).toHaveLength(0);
    for (const read of reads()) expect(read).not.toHaveBeenCalled();
  });

  it('an unknown id is a 404', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(null);
    await expect(call(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getFormatDetail).not.toHaveBeenCalled();
  });

  it("another admin's private format gets the forbidden notice and no draft is read", async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await call(ID);
    const notice = findByType(tree, ResourceForbidden);
    expect(notice).toHaveLength(1);
    expect(html(notice[0].props.children as ReactNode)).toBe('This format is private to its owner.');
    expect(mocks.getFormatDetail).not.toHaveBeenCalled();
  });

  it('the forbidden notice is in German for a German viewer', async () => {
    mocks.locale = 'de';
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await call(ID);
    expect(html(findByType(tree, ResourceForbidden)[0].props.children as ReactNode)).toContain('privat');
  });
});

describe('edit page', () => {
  it('a format shared by someone else is read, not edited: redirect to the read-only page, nothing read', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'league' }));
    await expect(EditPage(params(ID))).rejects.toThrow(`NEXT_REDIRECT:/admin/formats/${ID}`);
    expect(mocks.getFormatDetail).not.toHaveBeenCalled();
  });

  it('a gallery format of someone else redirects too', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'gallery' }));
    await expect(EditPage(params(ID))).rejects.toThrow('NEXT_REDIRECT');
  });

  it('the owner gets the editor with the props of the contract', async () => {
    mocks.getFormatDetail.mockResolvedValue(detail({ published: published() }));
    const tree = await EditPage(params(ID));
    const editor = findByType(tree, FormatEditor);
    expect(editor).toHaveLength(1);
    expect(editor[0].props).toEqual({
      definitionId: ID,
      summary: detail().definition,
      initial: { document: presetDoc(), draftRev: 3 },
      published: { versionNo: 2, contentHash: 'hash-2' },
      actor: { playerId: 'p1', isAdmin: false },
      // A stage names the DEFINITION id (or a legacy id that resolves to it); the version number labels the option ("OU Singles v3").
      rulesets: detail().rulesets,
      hasAttachments: false,
    });
    expect(mocks.getFormatDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getFormatDetail.mock.calls[0][1]).toMatchObject({ id: ID });
  });

  it('an unpublished format passes published as null', async () => {
    const tree = await EditPage(params(ID));
    expect(findByType(tree, FormatEditor)[0].props.published).toBeNull();
  });

  it('the props carry no owner id, no player row and no ruleset internals', async () => {
    const tree = await EditPage(params(ID));
    const serialised = JSON.stringify(findByType(tree, FormatEditor)[0].props);
    expect(serialised).not.toContain('owner_id');
    expect(serialised).not.toContain('discord_id');
    expect(serialised).not.toContain('secret');
    expect(serialised).not.toContain('created_by');
    expect(serialised).not.toContain('clauses');
  });

  it("a site admin edits another owner's private format", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true, playerId: 'p9' }));
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await EditPage(params(ID));
    const editor = findByType(tree, FormatEditor);
    expect(editor).toHaveLength(1);
    expect(editor[0].props.actor).toEqual({ playerId: 'p9', isAdmin: true });
  });

  it('an editable format without a readable draft is a 404', async () => {
    mocks.getFormatDetail.mockResolvedValue(detail({ draft: null }));
    await expect(EditPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('titles the page with the format name in the viewer language', async () => {
    mocks.locale = 'de';
    const out = html(await EditPage(params(ID)));
    expect(out).toContain('<h1');
    expect(out).toContain('Mein Pokal');
  });
});

describe('read-only page', () => {
  it('shows the published version with an Edit link for the owner, and a fork button', async () => {
    const head = { id: 'v1', version_no: 2, content_hash: 'hash-2', created_at: '2026-10-02T10:00:00Z' };
    mocks.getFormatDetail.mockResolvedValue(detail({ published: published(), definition: { ...detail().definition, current_version: head } }));
    const tree = await DetailPage(params(ID));
    const out = html(tree);
    const view = findByType(tree, FormatDetail)[0].props.view as { ok: boolean; definition: { stages: unknown[] } | null };
    expect(view.ok).toBe(true);
    expect(view.definition?.stages).toHaveLength(presetDoc('cup').stages.length);
    expect(findByType(tree, FormatDetail)[0].props.variant).toBe('page');
    expect(findByType(tree, ForkStoredButton)[0].props.definitionId).toBe(ID);
    expect(out).toContain(`href="/admin/formats/${ID}/edit"`);
    expect(out).toContain('href="/admin/formats"');
    expect(out).toContain('Published v2');
    expect(out).toContain('By Alex');
  });

  it('an editor of an unpublished format sees the draft', async () => {
    const tree = await DetailPage(params(ID));
    const view = findByType(tree, FormatDetail)[0].props.view as { ok: boolean; definition: { stages: unknown[] } | null };
    expect(view.definition?.stages).toHaveLength(presetDoc().stages.length);
    expect(html(tree)).toContain('Draft');
  });

  it('someone who may only read a shared format sees no Edit link', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'league' }));
    mocks.getFormatDetail.mockResolvedValue(detail({ draft: null, published: published(), definition: { ...detail().definition, visibility: 'league', owner: { id: 'p2', name: 'Sam' } } }));
    const tree = await DetailPage(params(ID));
    const out = html(tree);
    expect(out).not.toContain('/edit"');
    expect(out).toContain('By Sam');
    expect(findByType(tree, ForkStoredButton)).toHaveLength(1);
  });

  it('a shared format with nothing to read says so', async () => {
    mocks.getFormatDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'league' }));
    mocks.getFormatDetail.mockResolvedValue(detail({ draft: null, published: null }));
    const tree = await DetailPage(params(ID));
    expect(findByType(tree, FormatDetail)).toHaveLength(0);
    expect(html(tree)).toContain('no published version');
  });

  it('names the rulesets of the stages by the id the document uses, a legacy id included', async () => {
    const tree = await DetailPage(params(ID));
    const view = findByType(tree, FormatDetail)[0].props.view as { rulesets: { id: string; name: string }[] };
    expect(view.rulesets).toEqual([
      { id: 'rs1', name: 'OU Singles' },
      { id: 'legacy-rs1', name: 'OU Singles' },
    ]);
  });

  it('reads the format once and hands the owner over as a name only', async () => {
    const tree = await DetailPage(params(ID));
    expect(mocks.getFormatDetail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(findByType(tree, FormatDetail)[0].props)).not.toContain('owner_id');
  });
});

describe('edit page loading state', () => {
  it('renders the three skeleton columns and a spinner', () => {
    const out = html(<Loading />);
    expect(out).toContain('role="status"');
    expect(out).toContain('lg:grid-cols-[15rem_minmax(0,1fr)]');
    expect((out.match(/animate-shimmer/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
