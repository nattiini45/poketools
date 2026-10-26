/**
 * The editor root (static markup): the toolbar, the outline, the inspector for the selected stage and the preview
 * for a preset, a blank document and a draft with problems; the error panel for a draft the form cannot show.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { ltext } from '@/lib/format-kit/client';
import { classifyApiError, publishRequest } from '@/lib/format-studio/editor/api';
import { blankDocument, normalizeDraft } from '@/lib/format-studio/editor/document';
import { setBestOf, updateStage } from '@/lib/format-studio/editor/ops';
import { isDirty } from '@/lib/format-studio/editor/state';
import type { FormatDefinitionSummary } from '@/lib/format-studio/library-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import FormatEditor, { inspectorFor, type FormatEditorProps } from '../../editor/FormatEditor';
import StageInspector from '../../editor/inspectors/StageInspector';
import { runPublishFlow } from '@/components/studio-shell/dialogs/PublishDialog';
import { useFormatEditor, type FormatEditorModel } from '../../editor/useFormatEditor';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc, stageNameOf } from './test-helpers';

const SUMMARY: FormatDefinitionSummary = {
  id: 'def-1',
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
};

function props(over: Partial<FormatEditorProps> = {}): FormatEditorProps {
  return {
    definitionId: 'def-1',
    summary: SUMMARY,
    initial: { document: presetDoc(), draftRev: 3 },
    published: null,
    actor: { playerId: 'p1', isAdmin: false },
    rulesets: [],
    hasAttachments: false,
    ...over,
  };
}

const render = (over: Partial<FormatEditorProps> = {}, locale: Locale = 'en') => renderWithI18n(<FormatEditor {...props(over)} />, { locale });
const t = (locale: Locale) => createTranslator(formatStudioEditorMessages, locale);

describe('FormatEditor: a preset', () => {
  it.each(['en', 'de'] as const)('renders the toolbar, outline, inspector and preview (%s)', (locale) => {
    const doc = presetDoc();
    const html = render({}, locale);
    const e = t(locale);
    for (const label of [e('toolbar.save'), e('toolbar.publish'), e('toolbar.share'), e('toolbar.fork'), e('toolbar.delete')]) {
      expect(html, label).toContain(`>${esc(label)}<`);
    }
    expect(html).toContain('href="/admin/formats"');
    expect(html).toContain('href="/admin/formats/def-1"');
    for (let i = 0; i < doc.stages.length; i += 1) expect(html).toContain(esc(stageNameOf(doc, i, locale)));
    expect(html).toMatch(new RegExp(`<h2 id="fe-inspector-heading"[^>]*>${esc(stageNameOf(doc, 0, locale))}</h2>`));
    expect(html).toContain('role="tablist"');
    expectNoLeftovers(html);
    expectLabelledControls(html);
    expectUniqueIds(html);
  });

  it('the preview has three tabs with Issues selected', () => {
    const html = render();
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(tabs[1]).toContain('aria-selected="false"');
  });

  it('a clean draft says all changes are saved and carries no unsaved marker', () => {
    const html = render();
    expect(html).toContain('All changes saved');
    expect(html).not.toContain('data-unsaved');
    expect(html).toContain('data-format-editor');
  });

  it('shows the visibility and the version in the toolbar as words', () => {
    expect(render()).toContain('Private');
    expect(render()).toContain('Not published yet');
    const published = render({ published: { versionNo: 2, contentHash: 'abc' }, summary: { ...SUMMARY, visibility: 'league' } });
    expect(published).toContain('Version 2');
    expect(published).toContain('Shared with league admins');
  });

  it('the outline folds on small screens behind a button that names the selection', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="fe-outline-panel"|<button[^>]*aria-controls="fe-outline-panel"[^>]*aria-expanded="false"/);
    expect(html).toContain(`Outline: ${esc(stageNameOf(presetDoc(), 0, 'en'))}`);
    expect(html).toMatch(/<nav id="fe-outline-panel"[^>]*class="[^"]*hidden[^"]*lg:block/);
    expect(html).toContain('aria-current="true"');
  });

  it('the layout classes keep the three columns and stop horizontal scroll', () => {
    const html = render();
    expect(html).toContain('lg:grid-cols-[15rem_minmax(0,1fr)]');
    expect(html).toContain('xl:grid-cols-[15rem_minmax(0,1fr)_24rem]');
    expect(html).toContain('min-w-0');
  });
});

describe('FormatEditor: delete', () => {
  it('is offered for an unpublished format its owner may delete', () => {
    expect(render()).toContain('>Delete<');
  });

  it('is absent once a version is published', () => {
    expect(render({ published: { versionNo: 1, contentHash: 'abc' } })).not.toContain('>Delete<');
  });

  it('is absent for a format with attachments, and for someone who may not delete it', () => {
    expect(render({ hasAttachments: true })).not.toContain('>Delete<');
    expect(render({ actor: { playerId: 'p2', isAdmin: false } })).not.toContain('>Delete<');
  });

  it('a site admin may delete another owner\'s unpublished format', () => {
    expect(render({ actor: { playerId: 'p9', isAdmin: true } })).toContain('>Delete<');
  });
});

describe('FormatEditor: other drafts', () => {
  it('opens a blank document with its single stage', () => {
    const html = render({ initial: { document: blankDocument('Blank format', 'en'), draftRev: 1 } });
    expect(html).toContain('Stage 1');
    expect(html).toContain('role="tablist"');
    expectLabelledControls(html);
    expectUniqueIds(html);
  });

  it('shows a draft with problems: counts in the toolbar, the field flagged in the inspector', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setBestOf(s, 2));
    const html = render({ initial: { document: doc, draftRev: 3 } });
    expect(html).toMatch(/\d+ errors?/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('No problems found');
  });

  it('fills in the defaults of a sparse draft written outside the editor', () => {
    const sparse = { schema_version: 1, identity: { name: ltext('en', 'Sparse') }, stages: [] };
    const html = render({ initial: { document: sparse, draftRev: 1 } });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-format-editor');
    expect(html).not.toContain('data-unsaved');
  });
});

describe('FormatEditor: a draft the form cannot show', () => {
  const unreadable = [
    ['stages that are not a list', { schema_version: 1, identity: { name: ltext('en', 'Odd') }, stages: 'nope' }],
    ['a stage that is not an object', { schema_version: 1, identity: { name: ltext('en', 'Odd') }, stages: [5] }],
    ['null', null],
    ['a list', []],
  ] as const;

  it.each(unreadable)('%s: shows the error panel, a download and a replace button, and no inspector', (_name, document) => {
    const html = render({ initial: { document, draftRev: 4 } });
    expect(html).toContain('This draft cannot be edited as a form');
    expect(html).toContain('Download draft as JSON');
    expect(html).toContain('download="format-draft.json"');
    expect(html).toContain('href="data:application/json');
    expect(html).toContain('>Replace with a blank format<');
    expect(html).not.toContain('data-inspector');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('>Save draft<');
  });

  it('is in German for a German viewer', () => {
    const html = render({ initial: { document: null, draftRev: 4 } }, 'de');
    expect(html).toContain('lässt sich nicht als Formular bearbeiten');
    expect(html).toContain('Entwurf als JSON herunterladen');
    expectNoLeftovers(html);
  });
});

// ─── The editor's save and reload flows ──────────────────────────────────────────────────────────────────────────
// The hook runs once on the server here; its reducer mirror updates as actions are dispatched, so `latest()` is the
// state a browser would show after the same sequence, and the requests go to a fake `fetch`.

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const saved = (rev: number) => json(200, { success: true, data: { draft_rev: rev, updated_at: '2026-10-24T10:00:00Z', name: {}, check: {} } });
const stale = (rev: number) => json(409, { success: false, error: 'stale', code: 'format_stale_revision', params: { draft_rev: rev } });

interface Call {
  url: string;
  method: string | undefined;
  body: { draft_rev?: number; document?: unknown } | null;
}

function mount(responses: (Response | Error | Promise<Response>)[], rev = 3) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  let model!: FormatEditorModel;
  function Probe() {
    // The probe hands the hook's result to the test, outside React.
    // eslint-disable-next-line react-hooks/globals
    model = useFormatEditor({ definitionId: 'def-1', initialDoc: presetDoc(), initialRev: rev, rulesetIds: new Set(), fetchImpl });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return { model: () => model, calls, fetchImpl };
}

const edited = () => ({ ...presetDoc(), theme: { world: 'plaza' } });

describe('the editor flows: save', () => {
  it('a clean draft is not sent', async () => {
    const { model, calls } = mount([]);
    expect(await model().save()).toBe('clean');
    expect(calls).toHaveLength(0);
  });

  it('sends the draft at the known revision, adopts the new one and is clean again', async () => {
    const { model, calls } = mount([saved(4)]);
    model().edit(edited());
    expect(isDirty(model().latest())).toBe(true);
    expect(await model().save()).toBe('saved');
    expect(calls).toEqual([{ url: '/api/formats/def-1/draft', method: 'PUT', body: { draft_rev: 3, document: edited() } }]);
    const state = model().latest();
    expect(state.rev).toBe(4);
    expect(isDirty(state)).toBe(false);
    expect(state.save).toEqual({ status: 'saved', at: '2026-10-24T10:00:00Z' });
  });

  it('an edit made while the save is running stays unsaved', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { model } = mount([pending]);
    model().edit(edited());
    const running = model().save();
    expect(model().latest().save.status).toBe('saving');
    model().edit({ ...edited(), theme: { world: 'sakura' } });
    release(saved(4));
    expect(await running).toBe('saved');
    expect(model().latest().rev).toBe(4);
    expect(isDirty(model().latest())).toBe(true);
  });

  it('a second save while one runs is refused and sends nothing', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { model, calls } = mount([pending]);
    model().edit(edited());
    const first = model().save();
    expect(await model().save()).toBe('busy');
    release(saved(4));
    await first;
    expect(calls).toHaveLength(1);
  });

  it('the revision is current right after the await, so a publish can use it at once', async () => {
    const { model } = mount([saved(7)]);
    model().edit(edited());
    await model().save();
    expect(model().latest().rev).toBe(7);
  });

  it.each([
    ['a server error', () => [json(500, { success: false, error: 'boom' })], 'unknown_error'],
    ['a rate limit', () => [json(429, { success: false, error: 'slow down' }, { 'retry-after': '30' })], 'rate_limited'],
    ['no connection', () => [new TypeError('fetch failed')], 'network_error'],
  ] as const)('%s: the save fails, the draft stays unsaved and the error is kept by its code', async (_name, responses, code) => {
    const { model } = mount([...responses()]);
    model().edit(edited());
    expect(await model().save()).toBe('failed');
    const state = model().latest();
    expect(state.save.status).toBe('error');
    expect(state.save.status === 'error' && state.save.error.code).toBe(code);
    expect(isDirty(state)).toBe(true);
    expect(state.rev).toBe(3);
  });
});

describe('the editor flows: a conflict', () => {
  it('a stale revision opens a conflict at the server revision; Save again asks nothing of the server', async () => {
    const { model, calls } = mount([stale(9)]);
    model().edit(edited());
    expect(await model().save()).toBe('conflict');
    expect(model().latest().save).toEqual({ status: 'conflict', serverRev: 9 });
    expect(await model().save()).toBe('conflict');
    expect(calls).toHaveLength(1);
  });

  it('an edit does not clear the conflict', async () => {
    const { model } = mount([stale(9)]);
    model().edit(edited());
    await model().save();
    model().edit({ ...edited(), theme: { world: 'sakura' } });
    expect(model().latest().save.status).toBe('conflict');
  });

  it('Keep mine adopts the server revision, stays unsaved, and the next save goes out at that revision', async () => {
    const { model, calls } = mount([stale(9), saved(10)]);
    model().edit(edited());
    await model().save();
    model().keepMine();
    expect(model().latest().rev).toBe(9);
    expect(isDirty(model().latest())).toBe(true);
    expect(await model().save({ rev: 9, force: true })).toBe('saved');
    expect(calls[1].body?.draft_rev).toBe(9);
    expect(model().latest().rev).toBe(10);
    expect(isDirty(model().latest())).toBe(false);
  });

  it('Reload adopts the server document and revision, clean', async () => {
    const serverDraft = { ...presetDoc(), theme: { world: 'sakura' } };
    const detail = { success: true, data: { definition: {}, draft: { document: serverDraft, draft_rev: 9 }, published: null, versions: [], check: null } };
    const { model, calls } = mount([stale(9), json(200, detail)]);
    model().edit(edited());
    await model().save();
    expect(await model().reload()).toEqual({ ok: true });
    expect(calls[1]).toMatchObject({ url: '/api/formats/def-1', method: 'GET' });
    const state = model().latest();
    const expected = normalizeDraft(serverDraft);
    expect(expected.ok).toBe(true);
    expect(state.doc).toEqual(expected.ok ? expected.doc : null);
    expect(state.rev).toBe(9);
    expect(isDirty(state)).toBe(false);
    expect(state.save.status).toBe('idle');
  });

  it('Reload fails cleanly when the request fails or the server draft cannot be shown', async () => {
    const failing = mount([json(500, { success: false, error: 'boom' })]);
    expect(await failing.model().reload()).toMatchObject({ ok: false, reason: 'request' });
    const odd = { success: true, data: { definition: {}, draft: { document: { stages: 'nope' }, draft_rev: 9 }, published: null, versions: [], check: null } };
    const unreadable = mount([json(200, odd)]);
    expect(await unreadable.model().reload()).toEqual({ ok: false, reason: 'unreadable' });
    expect(unreadable.model().latest().rev).toBe(3);
  });
});

const published = (versionNo: number) =>
  json(200, { success: true, data: { version: { version_no: versionNo, content_hash: `hash-${versionNo}` }, check: {} } });

describe('the editor flows: publish', () => {
  const noChangelog = { en: '', de: '' };
  const flow = (m: ReturnType<typeof mount>, dirty: boolean) =>
    runPublishFlow({
      dirty,
      changelog: noChangelog,
      authorBase: 'en',
      save: () => m.model().save(),
      latest: () => m.model().latest(),
      publish: (rev, changelog) => publishRequest('def-1', rev, changelog, m.fetchImpl),
      classify: classifyApiError,
    });

  it('a clean draft is published at the known revision', async () => {
    const m = mount([published(2)]);
    expect(await flow(m, false)).toEqual({ kind: 'published', version: { versionNo: 2, contentHash: 'hash-2' } });
    expect(m.calls).toEqual([{ url: '/api/formats/def-1/publish', method: 'POST', body: { draft_rev: 3 } }]);
  });

  it('unsaved changes are saved first and the publish goes out at the new revision', async () => {
    const m = mount([saved(4), published(1)]);
    m.model().edit(edited());
    expect(await flow(m, true)).toMatchObject({ kind: 'published' });
    expect(m.calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(m.calls[1].body?.draft_rev).toBe(4);
  });

  it('a stale revision on the publish is a conflict that names the server revision', async () => {
    const m = mount([stale(9)]);
    expect(await flow(m, false)).toEqual({ kind: 'conflict', staleRev: 9 });
    expect(m.calls).toHaveLength(1);
  });

  it('a stale revision on the save before it is a conflict and nothing is published', async () => {
    const m = mount([stale(9)]);
    m.model().edit(edited());
    expect(await flow(m, true)).toEqual({ kind: 'conflict' });
    expect(m.calls.map((c) => c.method)).toEqual(['PUT']);
  });

  it('any other failure of the publish is reported with its error', async () => {
    const m = mount([json(500, { success: false, error: 'boom' })]);
    expect(await flow(m, false)).toMatchObject({ kind: 'failed', error: { code: 'unknown_error' } });
  });

  it('a failed save before it is reported with the save error', async () => {
    const m = mount([new TypeError('fetch failed')]);
    m.model().edit(edited());
    expect(await flow(m, true)).toMatchObject({ kind: 'failed', error: { code: 'network_error' } });
    expect(m.calls).toHaveLength(1);
  });
});

describe('the editor flows: a conflict found by a publish', () => {
  it('marks the conflict at the server revision on a clean editor, so Keep mine uses it at once', () => {
    const { model } = mount([]);
    expect(model().latest().save.status).toBe('idle');
    model().markConflict(9);
    expect(model().latest().save).toEqual({ status: 'conflict', serverRev: 9 });
    model().keepMine();
    expect(model().latest().rev).toBe(9);
    expect(model().latest().save.status).toBe('idle');
  });

  it('without a revision it keeps the one a conflict already named, else the editor revision', async () => {
    const fresh = mount([]);
    fresh.model().markConflict();
    expect(fresh.model().latest().save).toEqual({ status: 'conflict', serverRev: 3 });

    const known = mount([stale(9)]);
    known.model().edit(edited());
    await known.model().save();
    known.model().markConflict();
    expect(known.model().latest().save).toEqual({ status: 'conflict', serverRev: 9 });
  });

  it('after a stale publish the conflict is registered, so no second request is needed to open it', async () => {
    const m = mount([stale(9)]);
    const outcome = await runPublishFlow({
      dirty: false,
      changelog: { en: '', de: '' },
      authorBase: 'en',
      save: () => m.model().save(),
      latest: () => m.model().latest(),
      publish: (rev, changelog) => publishRequest('def-1', rev, changelog, m.fetchImpl),
      classify: classifyApiError,
    });
    expect(outcome).toEqual({ kind: 'conflict', staleRev: 9 });
    m.model().markConflict(outcome.kind === 'conflict' ? outcome.staleRev : undefined);
    expect(m.model().latest().save).toEqual({ status: 'conflict', serverRev: 9 });
    // A save is now refused until the user decides, without any request.
    m.model().edit(edited());
    expect(await m.model().save()).toBe('conflict');
    expect(m.calls).toHaveLength(1);
  });
});

describe('the inspector for the selected part', () => {
  const doc = presetDoc();
  const pick = (section: 'stage' | 'identity', index: number) =>
    inspectorFor({ selection: { section, index }, doc, diagnostics: [], onChange: () => undefined, authorBase: 'en', rulesets: [], noStageText: 'No stage' });

  it('keys the stage inspector by the stage, so an open key draft is not carried to another stage', () => {
    const first = pick('stage', 0);
    const second = pick('stage', 1);
    expect(first.type).toBe(StageInspector);
    expect(second.type).toBe(StageInspector);
    expect(first.key).toBe('0');
    expect(second.key).toBe('1');
    expect(first.key).not.toBe(second.key);
  });

  it('shows a line instead of an inspector for a stage that does not exist', () => {
    const element = pick('stage', 99);
    expect(element.type).toBe('p');
    expect(element.props).toMatchObject({ children: 'No stage' });
  });

  it('the other parts of the form are not keyed by a stage', () => {
    expect(pick('identity', 0).key).toBeNull();
  });
});
