import 'server-only';
/**
 * Ruleset readers (plan 3.6.2, 3.7): `ruleset_list`, `ruleset_get`, `ruleset_usage`, `ruleset_version_get`.
 *
 * They bind to the Ruleset Studio library (`/api/ruleset-definitions/**` logic), never to the legacy flat
 * `/api/rulesets*` bridge. Visibility is the library's own: the actor decides what a list contains and whether the
 * draft, the version list and the check are returned (owner, league admins of a league-owned ruleset, site admins).
 * `ruleset_get` returns the draft document only on request, fenced and cut, because a document can be 256 KiB.
 */
import { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { listRulesetDefinitions, getRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetDetail, toActor } from '@/lib/ruleset-studio/library';
import { listUsage } from '@/lib/ruleset-studio/pins';
import { defineRunnable } from '../registry/define';
import { capped, code, id, intArg, isoDateTime, label, paged, pagedResult, userText, uuidArg } from '../registry/atoms';
import { fence, fenceLText, fenceLTextBody, fenceLabel, fenceText } from '../registry/fence';
import { checkOut, listOut, toCheckOut, toListOut } from '../registry/projections';

const VERSION_CAP = 30;
const USAGE_TARGET_CAP = 60;
/** Characters of a draft document returned on request (a document can be 256 KiB). */
export const DOCUMENT_TEXT_CAP = 24_000;

const notFound = () => new UserFacingError('Ruleset not found', { code: 'ruleset_not_found', status: 404 });

const versionRef = z.strictObject({
  id: id(),
  version_no: z.number().int(),
  base_preset: code().nullable(),
  catalog_version: code(),
  created_at: isoDateTime(),
});

const definitionOut = z.strictObject({
  id: id(),
  slug: code(),
  label: label(),
  description_user_text: userText(),
  kind: z.enum(['preset', 'custom']),
  visibility: z.enum(['private', 'league', 'gallery']),
  owner_label: label().nullable(),
  league_id: id().nullable(),
  forked_from: id().nullable(),
  draft_rev: z.number().int(),
  updated_at: isoDateTime(),
  current_version: versionRef.nullable(),
});

type DefinitionInput = {
  id: string;
  slug: string;
  name: Parameters<typeof fenceLText>[0];
  description: Parameters<typeof fenceLTextBody>[0];
  kind: 'preset' | 'custom';
  visibility: 'private' | 'league' | 'gallery';
  owner: { id: string; name: string } | null;
  season_id: string | null;
  forked_from: string | null;
  draft_rev: number;
  updated_at: string;
  current_version: { id: string; version_no: number; base_preset: string | null; catalog_version: string; created_at: string } | null;
};

function toDefinitionOut(row: DefinitionInput, locale: 'en' | 'de') {
  return {
    id: row.id,
    slug: row.slug,
    label: fenceLText(row.name, locale),
    description_user_text: fenceLTextBody(row.description, locale),
    kind: row.kind,
    visibility: row.visibility,
    owner_label: row.owner === null ? null : fenceLabel(row.owner.name),
    league_id: row.season_id,
    forked_from: row.forked_from,
    draft_rev: row.draft_rev,
    updated_at: row.updated_at,
    current_version:
      row.current_version === null
        ? null
        : {
            id: row.current_version.id,
            version_no: row.current_version.version_no,
            base_preset: row.current_version.base_preset,
            catalog_version: row.current_version.catalog_version,
            created_at: row.current_version.created_at,
          },
  };
}

// ─── ruleset_list ────────────────────────────────────────────────────────────

export const rulesetList = defineRunnable('any', {
  name: 'ruleset_list',
  class: 'R',
  description:
    'List the rulesets the admin may see: their own, and those shared with all admins; a site admin sees every one. Each has a current published version id, which is what a league, phase or tournament pins. A ruleset with no current version is a draft that cannot be pinned yet. Paged: pass offset to continue; the result says when more rows follow. scope is all, mine, shared or gallery.',
  args: z.strictObject({
    scope: z.enum(['all', 'mine', 'shared', 'gallery']).optional(),
    visibility: z.enum(['private', 'league', 'gallery']).optional(),
    kind: z.enum(['preset', 'custom']).optional(),
    limit: intArg('Rows per page', 1, 100).optional(),
    offset: intArg('Rows to skip', 0, 100_000).optional(),
  }),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({ rulesets: paged(definitionOut) }),
  async execute(args, guarded, ctx) {
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const scope = args.scope ?? 'all';
    const { items, total } = await listRulesetDefinitions({
      actor: toActor(guarded.player),
      // The gallery is the rows shared with everyone: the visibility filter does the work (as the route does).
      scope: scope === 'gallery' ? 'all' : scope,
      visibility: scope === 'gallery' ? 'gallery' : args.visibility,
      kind: args.kind,
      limit,
      offset,
    });
    return { rulesets: pagedResult(items.map((row) => toDefinitionOut(row, ctx.locale)), total, limit, offset) };
  },
});

// ─── ruleset_get ─────────────────────────────────────────────────────────────

export const rulesetGet = defineRunnable('rulesetViewer', {
  name: 'ruleset_get',
  class: 'R',
  description:
    'Get one ruleset by its definition id: summary, the latest published version (its id is what a league pins), and, for the owner, league admins of a league-owned ruleset and site admins, the private draft with its revision, the compile check of the draft and the version list. Pass include_document true to also get the draft document text (cut at 24,000 characters) when you must patch it; otherwise read ruleset_version_get or ruleset_build_preview. Entries are dex ids.',
  args: z.strictObject({
    ruleset_id: uuidArg('Ruleset definition id'),
    include_document: z.boolean().optional().describe('Also return the draft document text'),
  }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetViewer', id: args.ruleset_id }),
  output: z.strictObject({
    definition: definitionOut,
    latest_version: versionRef
      .extend({ gen: z.number().int(), is_doubles: z.boolean() })
      .nullable(),
    draft: z
      .strictObject({
        draft_rev: z.number().int(),
        check: checkOut.nullable(),
        document_user_text: userText(DOCUMENT_TEXT_CAP),
        document_truncated: z.boolean(),
      })
      .nullable(),
    versions: capped(z.strictObject({ id: id(), version_no: z.number().int(), base_preset: code().nullable(), created_at: isoDateTime() })),
  }),
  async execute(args, guarded, ctx) {
    const { definition, actor } = guarded.ruleset;
    const detail = await getRulesetDetail(actor, definition);
    const published = detail.published;
    const documentText =
      args.include_document === true && detail.draft !== null ? JSON.stringify(detail.draft.document) : '';
    return {
      definition: toDefinitionOut(detail.definition, ctx.locale),
      latest_version:
        published === null
          ? null
          : {
              id: published.id,
              version_no: published.version_no,
              base_preset: published.base_preset,
              catalog_version: published.catalog_version,
              created_at: published.created_at,
              gen: published.gen,
              is_doubles: published.is_doubles,
            },
      draft:
        detail.draft === null
          ? null
          : {
              draft_rev: detail.draft.draft_rev,
              check: detail.check === null ? null : toCheckOut(detail.check),
              document_user_text: fence(documentText, DOCUMENT_TEXT_CAP),
              document_truncated: documentText.length > DOCUMENT_TEXT_CAP,
            },
      versions: {
        items: detail.versions.slice(0, VERSION_CAP).map((v) => ({ id: v.id, version_no: v.version_no, base_preset: v.base_preset, created_at: v.created_at })),
        total: detail.versions.length,
        truncated: detail.versions.length > VERSION_CAP,
        cap: VERSION_CAP,
      },
    };
  },
});

// ─── ruleset_usage ───────────────────────────────────────────────────────────

export const rulesetUsage = defineRunnable('rulesetViewer', {
  name: 'ruleset_usage',
  class: 'R',
  description:
    'Show which versions of a ruleset leagues and phases pin: counts per version for anyone who may see the ruleset, and the names of the leagues and phases only for site admins and for admins of a league-owned ruleset. An owner of a shared ruleset learns how many leagues use it, not which ones. Read it before proposing a pin move.',
  args: z.strictObject({ ruleset_id: uuidArg('Ruleset definition id') }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetViewer', id: args.ruleset_id }),
  output: z.strictObject({
    counts: z.array(z.strictObject({ version_no: z.number().int(), seasons: z.number().int(), tournaments: z.number().int() })),
    targets_visible: z.boolean(),
    targets: capped(
      z.strictObject({ kind: z.enum(['season', 'tournament']), id: id(), label: label(), league_id: id().nullable(), version_no: z.number().int(), status: code() }),
    ),
  }),
  async execute(_args, guarded) {
    const { definition, actor } = guarded.ruleset;
    const usage = await listUsage(actor, definition);
    const targets = usage.targets ?? [];
    return {
      counts: usage.counts,
      targets_visible: usage.targets !== null,
      targets: {
        items: targets.slice(0, USAGE_TARGET_CAP).map((t) => ({
          kind: t.kind,
          id: t.id,
          label: fenceLabel(t.name ?? ''),
          league_id: t.season_id,
          version_no: t.version_no,
          status: t.status,
        })),
        total: targets.length,
        truncated: targets.length > USAGE_TARGET_CAP,
        cap: USAGE_TARGET_CAP,
      },
    };
  },
});

// ─── ruleset_version_get ─────────────────────────────────────────────────────

export const rulesetVersionGet = defineRunnable('rulesetViewer', {
  name: 'ruleset_version_get',
  class: 'R',
  description:
    'Get the frozen effective rules of one published ruleset version: clauses, the ban or allow list per category as dex ids (cut at 150 per list with a count), the minimum shared-type percentage and whether team constraints exist. A started league enforces exactly these frozen rules, whatever the ruleset\'s draft says now.',
  args: z.strictObject({
    ruleset_id: uuidArg('Ruleset definition id'),
    version_no: intArg('Version number', 1, 100_000),
  }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetViewer', id: args.ruleset_id }),
  output: z.strictObject({
    version: versionRef
      .extend({
        gen: z.number().int(),
        format_key: code(),
        universe: z.enum(['standard', 'national']),
        doubles: z.boolean(),
        clauses: z.array(code()),
        pokemon: listOut,
        moves: listOut,
        items: listOut,
        abilities: listOut,
        added_pokemon: listOut,
        min_shared_type_pct: z.number().int(),
        has_team_constraints: z.boolean(),
        custom_rules_user_text: userText(),
      })
      .nullable(),
  }),
  async execute(args, guarded) {
    const version = await getRulesetVersion(guarded.ruleset.definition.id, args.version_no);
    if (version === null) throw notFound();
    const rules = version.resolved;
    return {
      version: {
        id: version.id,
        version_no: version.version_no,
        base_preset: version.base_preset,
        catalog_version: version.catalog_version,
        created_at: version.created_at,
        gen: rules.gen,
        format_key: rules.format_key,
        universe: rules.universe,
        doubles: rules.doubles,
        clauses: rules.clauses,
        pokemon: toListOut(rules.pokemon),
        moves: toListOut(rules.moves),
        items: toListOut(rules.items),
        abilities: toListOut(rules.abilities),
        added_pokemon: toListOut({ mode: 'block', ids: rules.added_pokemon }),
        min_shared_type_pct: rules.min_shared_type_pct,
        has_team_constraints: rules.team_constraints !== null,
        custom_rules_user_text: fenceText(rules.custom_rules),
      },
    };
  },
});

export const RULESET_READERS = [rulesetList, rulesetGet, rulesetUsage, rulesetVersionGet] as const;
