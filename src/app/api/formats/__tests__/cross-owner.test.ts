/**
 * The cross-owner matrix, with the REAL guards: only the session (`@/auth`), the resource-admin lookup and the
 * query layer are mocked, so a route that skipped a guard or an authorization rule fails here. League admins only
 * ever see and change their own formats and their own leagues; one test per row of the matrix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  countFormatVersions: vi.fn(),
  countSeasonFormatsOfDefinition: vi.fn(),
  createFormatDefinition: vi.fn(),
  deleteFormatDefinition: vi.fn(),
  getFormatDefinitionDraft: vi.fn(),
  getFormatDefinitionMeta: vi.fn(),
  getFormatVersion: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
  listFormatVersions: vi.fn(),
  publishFormatVersion: vi.fn(),
  saveFormatDraft: vi.fn(),
  setFormatVisibility: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  attachSeasonFormat: vi.fn(),
  detachSeasonFormat: vi.fn(),
  getExistingRulesetIds: vi.fn(),
  getSeasonFormat: vi.fn(),
  getSeasonFormatSummary: vi.fn(),
  getSeasonManualPhaseCount: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));

import { auth, loadSessionPlayer } from '@/auth';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import {
  countFormatVersions,
  countSeasonFormatsOfDefinition,
  createFormatDefinition,
  deleteFormatDefinition,
  getFormatDefinitionDraft,
  getFormatDefinitionMeta,
  getFormatVersion,
  getLatestPublishedVersion,
  listFormatVersions,
  publishFormatVersion,
  saveFormatDraft,
  setFormatVisibility,
} from '@/lib/supabase/queries/format-definitions';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import {
  attachSeasonFormat,
  detachSeasonFormat,
  getExistingRulesetIds,
  getSeasonFormat,
  getSeasonFormatSummary,
  getSeasonManualPhaseCount,
  getSeasonStartSignals,
} from '@/lib/supabase/queries/season-formats';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { PRESETS, compile, contentHash, ltext, type FormatDefinition } from '@/lib/format-kit';
import type { FormatDefinitionMeta, FormatVersion, SeasonFormatSummary } from '@/lib/format-studio/library-types';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { DELETE as deleteFormat, GET as getFormat, PATCH as patchFormat } from '../[id]/route';
import { PUT as putDraft } from '../[id]/draft/route';
import { POST as publishFormat } from '../[id]/publish/route';
import { POST as forkFormat } from '../[id]/fork/route';
import {
  DELETE as detachSeasonFormat_,
  GET as getSeasonFormat_,
  POST as attachToSeason,
} from '../../seasons/[id]/format/route';

const A = '11111111-1111-4111-8111-11111111111a';
const B = '22222222-2222-4222-8222-22222222222b';
const SITE = '99999999-9999-4999-8999-999999999999';
const DEF = '33333333-3333-4333-8333-333333333333';
const SEASON_S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa5a';
const SEASON_T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa7b';
const RULESET = '00000000-0000-4000-8000-000000000001';
const STAGE_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const STAGE_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';

function sessionPlayer(playerId: string, name: string, isAdmin = false): SessionPlayer {
  return {
    playerId,
    name,
    isAdmin,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  };
}
const leagueAdminA = sessionPlayer(A, 'Admin A');
const leagueAdminB = sessionPlayer(B, 'Admin B');
const siteAdmin = sessionPlayer(SITE, 'Site Admin', true);

function actAs(player: SessionPlayer): void {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: `identity-${player.playerId}` }, provider: 'discord' });
  vi.mocked(loadSessionPlayer).mockResolvedValue({ ...player });
}

const meta = (overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta => ({
  id: DEF,
  slug: 'spring-cup',
  name: ltext('en', 'Spring cup'),
  description: null,
  kind: 'custom',
  owner_id: A,
  visibility: 'private',
  forked_from: null,
  draft_rev: 3,
  current_version_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

function storedVersion(): FormatVersion {
  const spec = structuredClone(compile(PRESETS.find((p) => p.id === 'cup')!.definition).definition as FormatDefinition);
  return {
    id: 'v1',
    definition_id: DEF,
    version_no: 1,
    schema_version: 1,
    content_hash: contentHash(spec),
    changelog: null,
    created_by: A,
    created_at: '2026-10-03T00:00:00.000Z',
    spec,
    status: 'published',
  };
}

const season = (): Season =>
  ({ id: SEASON_S, name: 'League S', format_type: 'custom', ruleset_id: RULESET, status: 'upcoming', language: 'en' }) as Season;

const summary: SeasonFormatSummary = {
  season_id: SEASON_S,
  definition_id: DEF,
  version_no: 1,
  spec_hash: 'a'.repeat(64),
  tunables: {},
  engine: 'kit',
  frozen_at: '2026-10-05T00:00:00.000Z',
  amendments: [],
};

/** The database state the definition under test lives in. */
function storeDefinition(definition: FormatDefinitionMeta): void {
  vi.mocked(getFormatDefinitionMeta).mockResolvedValue(definition);
}

const defParams = { params: Promise.resolve({ id: DEF }) };
const seasonParams = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const draftBody = () => ({ draft_rev: 3, document: structuredClone(PRESETS[1].definition) });

beforeEach(() => {
  vi.resetAllMocks();
  actAs(leagueAdminB);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  vi.mocked(resolvePlayerNames).mockResolvedValue({ [A]: 'Admin A', [B]: 'Admin B', [SITE]: 'Site Admin' });
  vi.mocked(listFormatVersions).mockResolvedValue([]);
  vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
  vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: structuredClone(PRESETS[1].definition), draft_rev: 3 });
  vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(0);
  vi.mocked(countFormatVersions).mockResolvedValue(0);
  // League admin B administers season S, and nothing else.
  vi.mocked(isResourceAdminFor).mockImplementation(async (playerId, type, id) => playerId === B && type === 'season' && id === SEASON_S);
});

/** Nothing of the target was read through a mutating query. */
function expectNoFormatWrite(): void {
  expect(saveFormatDraft).not.toHaveBeenCalled();
  expect(publishFormatVersion).not.toHaveBeenCalled();
  expect(setFormatVisibility).not.toHaveBeenCalled();
  expect(deleteFormatDefinition).not.toHaveBeenCalled();
  expect(createFormatDefinition).not.toHaveBeenCalled();
}

describe('cross-owner matrix: the format library', () => {
  it('1. GET /api/formats/[id]: league admin B, private definition of A -> 403', async () => {
    storeDefinition(meta({ visibility: 'private' }));
    const response = await getFormat(json(`/api/formats/${DEF}`, 'GET'), defParams);
    expect(response.status).toBe(403);
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
  });

  it.each(['private', 'league', 'gallery'] as const)('2. PATCH visibility: league admin B, %s definition of A -> 403', async (visibility) => {
    storeDefinition(meta({ visibility, current_version_id: 'v1' }));
    const response = await patchFormat(json(`/api/formats/${DEF}`, 'PATCH', { visibility: 'private' }), defParams);
    expect(response.status).toBe(403);
    expectNoFormatWrite();
  });

  it('3. PATCH visibility to gallery: league admin A (owner), own definition -> 403 format_visibility_forbidden', async () => {
    actAs(leagueAdminA);
    storeDefinition(meta({ current_version_id: 'v1' }));
    const response = await patchFormat(json(`/api/formats/${DEF}`, 'PATCH', { visibility: 'gallery' }), defParams);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_visibility_forbidden');
    expectNoFormatWrite();
  });

  it.each(['private', 'league', 'gallery'] as const)('4. DELETE: league admin B, %s definition of A -> 403', async (visibility) => {
    storeDefinition(meta({ visibility }));
    const response = await deleteFormat(json(`/api/formats/${DEF}`, 'DELETE'), defParams);
    expect(response.status).toBe(403);
    expect(countSeasonFormatsOfDefinition).not.toHaveBeenCalled();
    expectNoFormatWrite();
  });

  it.each(['private', 'league', 'gallery'] as const)('5. PUT draft: league admin B, %s definition of A -> 403', async (visibility) => {
    storeDefinition(meta({ visibility }));
    const response = await putDraft(json(`/api/formats/${DEF}/draft`, 'PUT', draftBody()), defParams);
    expect(response.status).toBe(403);
    expectNoFormatWrite();
  });

  it.each(['private', 'league', 'gallery'] as const)('6. POST publish: league admin B, %s definition of A -> 403', async (visibility) => {
    storeDefinition(meta({ visibility }));
    const response = await publishFormat(json(`/api/formats/${DEF}/publish`, 'POST', { draft_rev: 3 }), defParams);
    expect(response.status).toBe(403);
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expectNoFormatWrite();
  });

  it('7. POST publish: owner A, own definition in the gallery -> 403 format_published_locked', async () => {
    actAs(leagueAdminA);
    storeDefinition(meta({ visibility: 'gallery', current_version_id: 'v1' }));
    const response = await publishFormat(json(`/api/formats/${DEF}/publish`, 'POST', { draft_rev: 3 }), defParams);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_published_locked');
    expectNoFormatWrite();
  });

  it('8. POST fork: league admin B, private definition of A -> 403', async () => {
    storeDefinition(meta({ visibility: 'private', current_version_id: 'v1' }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion());
    const response = await forkFormat(json(`/api/formats/${DEF}/fork`, 'POST', {}), defParams);
    expect(response.status).toBe(403);
    expect(getLatestPublishedVersion).not.toHaveBeenCalled();
    expectNoFormatWrite();
  });

  it('9. POST fork: league admin B, league-visible definition of A -> 201, the copy is owned by B and forked_from is set', async () => {
    storeDefinition(meta({ visibility: 'league', current_version_id: 'v1' }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion());
    vi.mocked(createFormatDefinition).mockImplementation(async (input) =>
      meta({ id: 'new-id', slug: input.slug, name: input.name, owner_id: input.ownerId, forked_from: input.forkedFrom, draft_rev: 1 }),
    );
    const response = await forkFormat(json(`/api/formats/${DEF}/fork`, 'POST', {}), defParams);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.definition.owner).toEqual({ id: B, name: 'Admin B' });
    expect(body.data.definition.forked_from).toBe(DEF);
    expect(vi.mocked(createFormatDefinition).mock.calls[0][0]).toMatchObject({ ownerId: B, forkedFrom: DEF });
  });

  it('13a. PUT draft on a preset row: league admin who owns it -> 403 format_preset_locked; site admin -> 200', async () => {
    storeDefinition(meta({ kind: 'preset', owner_id: B, visibility: 'gallery' }));
    const locked = await putDraft(json(`/api/formats/${DEF}/draft`, 'PUT', draftBody()), defParams);
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_preset_locked');
    expect(saveFormatDraft).not.toHaveBeenCalled();

    actAs(siteAdmin);
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 4, updated_at: '2026-10-06T00:00:00.000Z' });
    const allowed = await putDraft(json(`/api/formats/${DEF}/draft`, 'PUT', draftBody()), defParams);
    expect(allowed.status).toBe(200);
    expect(saveFormatDraft).toHaveBeenCalledTimes(1);
  });

  it('13b. POST publish on a preset row: league admin who owns it -> 403 format_preset_locked; site admin -> 201', async () => {
    storeDefinition(meta({ kind: 'preset', owner_id: B, visibility: 'gallery' }));
    const locked = await publishFormat(json(`/api/formats/${DEF}/publish`, 'POST', { draft_rev: 3 }), defParams);
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_preset_locked');
    expect(publishFormatVersion).not.toHaveBeenCalled();

    actAs(siteAdmin);
    vi.mocked(publishFormatVersion).mockResolvedValue({ versionId: 'v-new', versionNo: 1 });
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion());
    const allowed = await publishFormat(json(`/api/formats/${DEF}/publish`, 'POST', { draft_rev: 3 }), defParams);
    expect(allowed.status).toBe(201);
  });

  it('a site admin may read, edit and delete any definition', async () => {
    actAs(siteAdmin);
    storeDefinition(meta({ visibility: 'private' }));
    expect((await getFormat(json(`/api/formats/${DEF}`, 'GET'), defParams)).status).toBe(200);
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 4, updated_at: 'now' });
    expect((await putDraft(json(`/api/formats/${DEF}/draft`, 'PUT', draftBody()), defParams)).status).toBe(200);
    expect((await deleteFormat(json(`/api/formats/${DEF}`, 'DELETE'), defParams)).status).toBe(200);
  });

  it('a player without any admin tier is refused everywhere', async () => {
    actAs({ ...leagueAdminB, isResourceAdmin: false });
    storeDefinition(meta({ owner_id: B }));
    for (const response of [
      await getFormat(json(`/api/formats/${DEF}`, 'GET'), defParams),
      await putDraft(json(`/api/formats/${DEF}/draft`, 'PUT', draftBody()), defParams),
      await deleteFormat(json(`/api/formats/${DEF}`, 'DELETE'), defParams),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(getFormatDefinitionMeta).not.toHaveBeenCalled();
  });
});

describe('cross-owner matrix: attaching to a league', () => {
  beforeEach(() => {
    vi.mocked(getSeasonById).mockResolvedValue(season());
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'upcoming', phases: [] });
    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set());
    vi.mocked(getSeasonManualPhaseCount).mockResolvedValue(0);
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary);
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion());
    vi.mocked(attachSeasonFormat).mockResolvedValue({
      replaced: false,
      stages: [
        { id: STAGE_1, key: 'groups' },
        { id: STAGE_2, key: 'knockout' },
      ],
      removed_stage_ids: [],
    });
  });

  const attach = (seasonId = SEASON_S) =>
    attachToSeason(json(`/api/seasons/${seasonId}/format`, 'POST', { definition_id: DEF }), seasonParams(seasonId));

  it('10. POST /api/seasons/[id]/format: admin of league S, private definition of another owner -> 403 format_attach_forbidden', async () => {
    storeDefinition(meta({ owner_id: A, visibility: 'private', current_version_id: 'v1' }));
    const response = await attach();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_attach_forbidden');
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it.each(['league', 'gallery'] as const)('11. POST /api/seasons/[id]/format: admin of league S, %s definition of another owner -> 201', async (visibility) => {
    storeDefinition(meta({ owner_id: A, visibility, current_version_id: 'v1' }));
    const response = await attach();
    expect(response.status).toBe(201);
    expect(attachSeasonFormat).toHaveBeenCalledTimes(1);
  });

  it('11b. the owner of a private definition may attach it to their own league', async () => {
    storeDefinition(meta({ owner_id: B, visibility: 'private', current_version_id: 'v1' }));
    expect((await attach()).status).toBe(201);
  });

  it('12. POST / GET / DELETE /api/seasons/[id]/format: admin of league T, league S -> 403', async () => {
    // Admin B administers S only; the target is the league of someone else.
    vi.mocked(isResourceAdminFor).mockImplementation(async (playerId, type, id) => playerId === B && type === 'season' && id === SEASON_T);
    storeDefinition(meta({ owner_id: B, visibility: 'league', current_version_id: 'v1' }));
    const responses = [
      await attach(SEASON_S),
      await getSeasonFormat_(json(`/api/seasons/${SEASON_S}/format`, 'GET'), seasonParams(SEASON_S)),
      await detachSeasonFormat_(json(`/api/seasons/${SEASON_S}/format`, 'DELETE'), seasonParams(SEASON_S)),
    ];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
    expect(detachSeasonFormat).not.toHaveBeenCalled();
    expect(getSeasonFormat).not.toHaveBeenCalled();
  });

  it('a site admin may attach to any league', async () => {
    actAs(siteAdmin);
    storeDefinition(meta({ owner_id: A, visibility: 'private', current_version_id: 'v1' }));
    expect((await attach(SEASON_T)).status).toBe(201);
  });
});
