/**
 * Fixtures for the dev-only surfaces preview (`/ruleset-preview/surfaces`): the gallery, the read-only ruleset page, the pin
 * card, the usage panel, the pin confirmation dialog in every state, the league recycle bin and the Danger tab. Plain data
 * over the real types; nothing here reads a database.
 */
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import type { LeagueTrashPendingView, LeagueTrashRowView } from '@/lib/league-trash/client';
import type { RulesetDefinitionSummary, RulesetPinCounts, RulesetUsage, RulesetVersionSummary } from '@/lib/ruleset-studio/library-types';
import type { PinChangeSummary, PinImpact, RulesetPinInfo } from '@/lib/ruleset-studio/pin-info';
import { ltext } from '@/lib/studio-core/ltext';

export const SURFACES = ['gallery', 'detail', 'pins', 'dialogs', 'trash', 'danger'] as const;
export type SurfaceId = (typeof SURFACES)[number];
export const DEFAULT_SURFACE: SurfaceId = 'gallery';

export function isSurface(value: unknown): value is SurfaceId {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

/** A catalog version older than the running app's: every preset-based version published with it reads as stale. */
export const OLD_CATALOG_VERSION = 'catalog-before';

const OWNER = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Preview Admin' };
const OTHER_OWNER = { id: '00000000-0000-4000-8000-0000000000b2', name: 'Mira from the Draft League' };

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function head(versionNo: number, over: Partial<NonNullable<RulesetDefinitionSummary['current_version']>> = {}): NonNullable<RulesetDefinitionSummary['current_version']> {
  return {
    id: id(1000 + versionNo),
    version_no: versionNo,
    content_hash: `hash-${versionNo}`,
    created_at: '2026-10-12T10:00:00Z',
    catalog_version: PRESET_RULES_VERSION,
    base_preset: 'gen9ou',
    ...over,
  };
}

function definition(n: number, name: [string, string], over: Partial<RulesetDefinitionSummary> = {}): RulesetDefinitionSummary {
  return {
    id: id(n),
    slug: `preview-${n}`,
    name: ltext('en', name[0], name[1]),
    description: null,
    kind: 'custom',
    visibility: 'private',
    season_id: null,
    forked_from: null,
    draft_rev: 4,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    owner: OWNER,
    current_version: null,
    ...over,
  };
}

// ─── The gallery ────────────────────────────────────────────────────────────────────────────────────────────────

export const GALLERY = {
  mine: {
    items: [
      definition(1, ['Spring OU', 'Frühlings-OU'], {
        description: ltext('en', 'Gen 9 OU with the sleep clause off and the Tera Blast note for finals.', 'Gen-9-OU ohne Schlaf-Klausel, mit Tera-Blast-Hinweis fürs Finale.'),
        visibility: 'gallery',
        current_version: head(3, { catalog_version: OLD_CATALOG_VERSION }),
      }),
      definition(2, ['Berry cup with a rather long name that has to wrap on a phone', 'Beeren-Cup mit einem ziemlich langen Namen, der auf dem Handy umbrechen muss'], {
        current_version: null,
      }),
      definition(3, ['Winter Doubles', 'Winter-Doubles'], { visibility: 'league', current_version: head(1, { base_preset: 'gen9doublesou' }) }),
      definition(4, ['Champions roster', 'Champions-Kader'], { season_id: id(900), visibility: 'league', current_version: head(2, { base_preset: null, catalog_version: 'legacy' }) }),
    ],
    total: 4,
  },
  shared: {
    items: [
      definition(5, ['Community VGC', 'Community-VGC'], {
        owner: OTHER_OWNER,
        visibility: 'league',
        description: ltext('en', 'The rules the Tuesday league plays.', 'Die Regeln der Dienstagsliga.'),
        current_version: head(2, { base_preset: 'gen9vgc2026regf' }),
      }),
    ],
    total: 1,
  },
  site: {
    items: [definition(6, ['Standard OU', 'Standard-OU'], { kind: 'preset', owner: null, visibility: 'gallery', current_version: head(1) })],
    total: 1,
  },
  usage: new Map<string, RulesetPinCounts>([
    [id(1), { seasons: 2, tournaments: 1 }],
    [id(3), { seasons: 0, tournaments: 0 }],
    [id(4), { seasons: 1, tournaments: 0 }],
    [id(5), { seasons: 3, tournaments: 4 }],
    [id(6), { seasons: 12, tournaments: 0 }],
  ]),
  /** Ruleset names for the "New ruleset" dialog's copy list. */
  dialog: { shared: [{ id: id(5), name: 'Community VGC', version: 2 }] },
};

// ─── The read-only page of one ruleset ───────────────────────────────────────────────────────────────────────

export const DETAIL_ID = id(1);

export const DETAIL_SUMMARY: RulesetDefinitionSummary = { ...GALLERY.mine.items[0], current_version: head(4, { catalog_version: OLD_CATALOG_VERSION }) };

function version(n: number, over: Partial<RulesetVersionSummary> = {}): RulesetVersionSummary {
  return {
    id: id(1000 + n),
    version_no: n,
    schema_version: 1,
    name_text: 'Spring OU',
    content_hash: `hash-${n}`,
    resolved_hash: `resolved-${n}`,
    catalog_version: PRESET_RULES_VERSION,
    base_preset: 'gen9ou',
    gen: 9,
    format_key: 'gen9ou',
    is_doubles: false,
    changelog: null,
    created_by: OWNER.id,
    created_at: `2026-10-${String(4 + n * 3).padStart(2, '0')}T10:00:00Z`,
    ...over,
  };
}

export const DETAIL_VERSIONS: RulesetVersionSummary[] = [
  version(4, { changelog: ltext('en', 'Banned Gholdengo for the finals.', 'Gholdengo fürs Finale gebannt.'), catalog_version: OLD_CATALOG_VERSION }),
  version(3, { catalog_version: OLD_CATALOG_VERSION }),
  version(2, { catalog_version: OLD_CATALOG_VERSION }),
  version(1, { catalog_version: OLD_CATALOG_VERSION }),
];

const NO_CHANGE: PinChangeSummary = { banned: 0, unbanned: 0, allowed: 0, disallowed: 0, clausesAdded: 0, clausesRemoved: 0, modeChanged: false, otherChanged: false };

export const DETAIL_CHANGES = new Map<number, PinChangeSummary | null>([
  [4, { ...NO_CHANGE, banned: 2, unbanned: 1, clausesAdded: 1 }],
  [3, { ...NO_CHANGE }],
  [2, { ...NO_CHANGE, banned: 12, unbanned: 3, allowed: 0, clausesRemoved: 2, otherChanged: true }],
  [1, null],
]);

export const DETAIL_USAGE: RulesetUsage = {
  counts: [
    { version_no: 4, seasons: 1, tournaments: 0 },
    { version_no: 3, seasons: 0, tournaments: 1 },
    { version_no: 2, seasons: 1, tournaments: 0 },
  ],
  targets: [
    { kind: 'season', id: id(201), name: 'Spring League 2026', season_id: null, version_id: id(1004), version_no: 4, status: 'upcoming' },
    { kind: 'tournament', id: id(202), name: 'Finals bracket', season_id: id(201), version_id: id(1003), version_no: 3, status: 'in_progress' },
    { kind: 'season', id: id(203), name: 'Autumn League 2025 with an unusually long name that wraps on a phone', season_id: null, version_id: id(1002), version_no: 2, status: 'in_progress' },
    { kind: 'season', id: id(204), name: 'Summer League 2025', season_id: null, version_id: id(1002), version_no: 2, status: 'completed' },
  ],
};

// ─── The pin card and its dialog ─────────────────────────────────────────────────────────────────────────────────

const PIN_BASE: Omit<RulesetPinInfo, 'update'> = {
  definition_id: DETAIL_ID,
  name: 'Spring OU',
  version_id: id(1002),
  version_no: 2,
  can_view: true,
};

export const PIN_CHANGE: PinChangeSummary = { ...NO_CHANGE, banned: 3, unbanned: 1, clausesAdded: 1 };

export const PIN_CARDS = [
  {
    key: 'upcoming',
    kind: 'season' as const,
    target: { kind: 'season' as const, id: id(301), name: 'Spring League 2026', status: 'upcoming' },
    pin: { ...PIN_BASE, update: { version_no: 4, change: PIN_CHANGE } } satisfies RulesetPinInfo,
  },
  {
    key: 'running',
    kind: 'tournament' as const,
    target: { kind: 'tournament' as const, id: id(302), name: 'Group stage', status: 'in_progress' },
    pin: { ...PIN_BASE, update: { version_no: 4, change: PIN_CHANGE } } satisfies RulesetPinInfo,
  },
  {
    key: 'same-rules',
    kind: 'standalone' as const,
    target: { kind: 'tournament' as const, id: id(303), name: 'Friday cup', status: 'upcoming' },
    pin: { ...PIN_BASE, update: { version_no: 3, change: NO_CHANGE } } satisfies RulesetPinInfo,
  },
  {
    key: 'latest',
    kind: 'season' as const,
    target: { kind: 'season' as const, id: id(304), name: 'Winter League', status: 'in_progress' },
    pin: { ...PIN_BASE, version_no: 4, update: null, can_view: false } satisfies RulesetPinInfo,
  },
  {
    key: 'finished',
    kind: 'season' as const,
    target: { kind: 'season' as const, id: id(305), name: 'Summer League 2025', status: 'completed' },
    pin: { ...PIN_BASE, update: { version_no: 4, change: PIN_CHANGE } } satisfies RulesetPinInfo,
  },
];

const IMPACT_TARGET = { kind: 'season' as const, id: id(301) };

/** What the fake `pins/impact` route answers (several leagues, so the per-target list shows). */
export const FAKE_IMPACT = (versionNo: number): PinImpact => ({
  version_no: versionNo,
  checked: 38,
  would_break: 5,
  truncated: false,
  targets: [
    { ...IMPACT_TARGET, name: 'Spring League 2026', checked: 24, would_break: 3 },
    { kind: 'tournament', id: id(302), name: 'Group stage', checked: 14, would_break: 2 },
  ],
});

export const DIALOG_STATES = ['loading', 'ready-some', 'ready-all-valid', 'ready-none', 'ready-truncated', 'ready-many', 'failed'] as const;
export type DialogStateId = (typeof DIALOG_STATES)[number];

// ─── The league recycle bin ───────────────────────────────────────────────────────────────────────────────────────

export const TRASH_ROWS: LeagueTrashRowView[] = [
  {
    id: 'trash-ok',
    seasonId: id(401),
    name: 'Spring League 2026',
    formatLabel: 'Draft league',
    deletedAt: '2026-10-20T09:30:00Z',
    deletedByName: 'Preview Admin',
    purgeAfter: '2027-01-18T09:30:00Z',
    counts: { players: 16, phases: 3, matches: 48, games: 112, draftPools: 1 },
    rebuildPending: false,
    schemaChanged: false,
  },
  {
    id: 'trash-warn',
    seasonId: id(402),
    name: 'Evolution Liga Season 4 with a very long league name that has to wrap inside the table cell',
    formatLabel: 'Evolution point buy',
    deletedAt: '2026-10-02T18:05:00Z',
    deletedByName: null,
    purgeAfter: '2026-12-31T18:05:00Z',
    counts: { players: 24, phases: 5, matches: 120, games: 301, draftPools: 2 },
    rebuildPending: false,
    schemaChanged: true,
  },
  {
    id: 'trash-pending',
    seasonId: id(403),
    name: 'Test league',
    formatLabel: 'Singles',
    deletedAt: '2026-10-25T21:00:00Z',
    deletedByName: 'Preview Admin',
    purgeAfter: '2027-01-23T21:00:00Z',
    counts: { players: 4, phases: 1, matches: 0, games: 0, draftPools: 0 },
    rebuildPending: true,
    schemaChanged: false,
  },
  {
    id: 'trash-fail',
    seasonId: id(404),
    name: 'Refuses to restore',
    formatLabel: 'Singles',
    deletedAt: '2026-10-24T12:00:00Z',
    deletedByName: 'Preview Admin',
    purgeAfter: '2027-01-22T12:00:00Z',
    counts: { players: 0, phases: 0, matches: 0, games: 0, draftPools: 0 },
    rebuildPending: false,
    schemaChanged: false,
  },
];

export const TRASH_PENDING: LeagueTrashPendingView[] = [
  { kind: 'delete', trashId: 'trash-pending', seasonId: id(403), name: 'Test league', at: '2026-10-25T21:00:00Z' },
  { kind: 'restore', trashId: 'trash-old', seasonId: id(405), name: 'Winter League 2025', at: '2026-10-23T08:15:00Z' },
];

// ─── The Danger tab ───────────────────────────────────────────────────────────────────────────────────────────────

export const DANGER_LEAGUE = { id: id(501), name: 'Spring League 2026', archived: false };
