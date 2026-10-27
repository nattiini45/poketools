import 'server-only';
/**
 * Format Studio readers (plan 3.6.2, phase 3): `format_list`, `format_get`, `attachable_formats`,
 * `league_format_status`.
 *
 * Formats are read through the library's own functions after the live `requireFormatViewer` guard. A league's attached
 * format is read from the SUMMARY (`getSeasonFormatSummary`), which never selects the `season_formats.seed` column.
 */
import { z } from 'zod';
import { loadAttachCandidates } from '@/lib/format-studio/attach-candidates';
import { getFormatDetail, toActor } from '@/lib/format-studio/library';
import { getSeasonFormatSummary, getSeasonManualPhaseCount } from '@/lib/supabase/queries/season-formats';
import { listFormatDefinitions } from '@/lib/supabase/queries/format-definitions';
import { defineRunnable } from '../registry/define';
import { capped, code, id, intArg, isoDateTime, label, paged, pagedResult, userText, uuidArg } from '../registry/atoms';
import { fence, fenceLText, fenceLTextBody, fenceLabel, fenceText } from '../registry/fence';

const DIAGNOSTIC_CAP = 40;
const VERSION_CAP = 30;
const DOCUMENT_TEXT_CAP = 24_000;

const formatRef = z.strictObject({
  id: id(),
  slug: code(),
  label: label(),
  description_user_text: userText(),
  kind: z.enum(['preset', 'custom']),
  visibility: z.enum(['private', 'league', 'gallery']),
  owner_label: label().nullable(),
  draft_rev: z.number().int(),
  updated_at: isoDateTime(),
  current_version: z.strictObject({ id: id(), version_no: z.number().int(), created_at: isoDateTime() }).nullable(),
});

type FormatSummaryInput = Awaited<ReturnType<typeof listFormatDefinitions>>['items'][number];

function toFormatRef(row: FormatSummaryInput, locale: 'en' | 'de') {
  return {
    id: row.id,
    slug: row.slug,
    label: fenceLText(row.name, locale),
    description_user_text: fenceLTextBody(row.description, locale),
    kind: row.kind,
    visibility: row.visibility,
    owner_label: row.owner === null ? null : fenceLabel(row.owner.name),
    draft_rev: row.draft_rev,
    updated_at: row.updated_at,
    current_version:
      row.current_version === null
        ? null
        : { id: row.current_version.id, version_no: row.current_version.version_no, created_at: row.current_version.created_at },
  };
}

// ─── format_list ─────────────────────────────────────────────────────────────

export const formatList = defineRunnable('any', {
  name: 'format_list',
  class: 'R',
  description:
    'List the Format Studio formats the admin may see: their own and those shared with all admins; a site admin sees every one. A format with no current version is a draft that cannot be attached yet. Paged: pass offset to continue.',
  args: z.strictObject({
    scope: z.enum(['all', 'mine', 'shared']).optional(),
    visibility: z.enum(['private', 'league', 'gallery']).optional(),
    kind: z.enum(['preset', 'custom']).optional(),
    limit: intArg('Rows per page', 1, 100).optional(),
    offset: intArg('Rows to skip', 0, 100_000).optional(),
  }),
  phase: 3,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({ formats: paged(formatRef) }),
  async execute(args, guarded, ctx) {
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const { items, total } = await listFormatDefinitions({
      actor: toActor(guarded.player),
      scope: args.scope ?? 'all',
      visibility: args.visibility,
      kind: args.kind,
      limit,
      offset,
    });
    return { formats: pagedResult(items.map((row) => toFormatRef(row, ctx.locale)), total, limit, offset) };
  },
});

// ─── format_get ──────────────────────────────────────────────────────────────

export const formatGet = defineRunnable('formatViewer', {
  name: 'format_get',
  class: 'R',
  description:
    'Get one format by its definition id: summary, the latest published version, and, for the owner and site admins, the private draft with its revision, the compile check of the draft and the version list. Pass include_document true to also get the draft document text (cut at 24,000 characters) when you must patch it. The league-specific random seed is never returned.',
  args: z.strictObject({
    format_id: uuidArg('Format definition id'),
    include_document: z.boolean().optional().describe('Also return the draft document text'),
  }),
  phase: 3,
  guard: (args) => ({ kind: 'formatViewer', id: args.format_id }),
  output: z.strictObject({
    definition: formatRef,
    latest_version: z.strictObject({ id: id(), version_no: z.number().int(), created_at: isoDateTime() }).nullable(),
    draft: z
      .strictObject({
        draft_rev: z.number().int(),
        ok: z.boolean().nullable(),
        error_count: z.number().int(),
        warning_count: z.number().int(),
        diagnostics: capped(
          z.strictObject({
            code: code(),
            severity: z.enum(['error', 'warning', 'info']),
            pointer: z.string().regex(/^(\/[A-Za-z0-9_~\-]{1,64}){0,10}$/),
            params_user_text: userText(),
          }),
        ),
        document_user_text: userText(DOCUMENT_TEXT_CAP),
        document_truncated: z.boolean(),
      })
      .nullable(),
    versions: capped(z.strictObject({ id: id(), version_no: z.number().int(), created_at: isoDateTime() })),
  }),
  async execute(args, guarded, ctx) {
    const { definition } = guarded.format;
    const detail = await getFormatDetail(guarded.player, definition);
    const diagnostics = detail.check?.diagnostics ?? [];
    const documentText = args.include_document === true && detail.draft !== null ? JSON.stringify(detail.draft.document) : '';
    return {
      definition: toFormatRef(detail.definition, ctx.locale),
      latest_version:
        detail.published === null
          ? null
          : { id: detail.published.id, version_no: detail.published.version_no, created_at: detail.published.created_at },
      draft:
        detail.draft === null
          ? null
          : {
              draft_rev: detail.draft.draft_rev,
              ok: detail.check === null ? null : detail.check.ok,
              error_count: diagnostics.filter((d) => d.severity === 'error').length,
              warning_count: diagnostics.filter((d) => d.severity === 'warning').length,
              diagnostics: {
                items: diagnostics.slice(0, DIAGNOSTIC_CAP).map((d) => ({
                  code: d.code,
                  severity: d.severity,
                  pointer: /^(\/[A-Za-z0-9_~\-]{1,64}){0,10}$/.test(d.json_pointer) ? d.json_pointer : '/',
                  params_user_text: fenceText(JSON.stringify(d.params ?? {})),
                })),
                total: detail.check?.truncated ? null : diagnostics.length,
                truncated: detail.check?.truncated === true || diagnostics.length > DIAGNOSTIC_CAP,
                cap: DIAGNOSTIC_CAP,
              },
              document_user_text: fence(documentText, DOCUMENT_TEXT_CAP),
              document_truncated: documentText.length > DOCUMENT_TEXT_CAP,
            },
      versions: {
        items: detail.versions.slice(0, VERSION_CAP).map((v) => ({ id: v.id, version_no: v.version_no, created_at: v.created_at })),
        total: detail.versions.length,
        truncated: detail.versions.length > VERSION_CAP,
        cap: VERSION_CAP,
      },
    };
  },
});

// ─── attachable_formats ──────────────────────────────────────────────────────

export const attachableFormats = defineRunnable('any', {
  name: 'attachable_formats',
  class: 'R',
  description:
    'List the published formats the admin may attach to a league: their own, those shared with league admins and the gallery. Each has the latest version number to attach. The read covers at most 100 formats and says when it was cut.',
  args: z.strictObject({}),
  phase: 3,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    formats: capped(
      z.strictObject({ id: id(), slug: code(), label: label(), version_no: z.number().int(), visibility: z.enum(['private', 'league', 'gallery']), owner_label: label().nullable(), mine: z.boolean() }),
    ),
  }),
  async execute(_args, guarded, ctx) {
    const { items, capped: wasCapped } = await loadAttachCandidates(guarded.player);
    return {
      formats: {
        items: items.map((item) => ({
          id: item.id,
          slug: item.slug,
          label: fenceLText(item.name, ctx.locale),
          version_no: item.version_no,
          visibility: item.visibility,
          owner_label: item.ownerName === null ? null : fenceLabel(item.ownerName),
          mine: item.mine,
        })),
        total: wasCapped ? null : items.length,
        truncated: wasCapped,
        cap: 100,
      },
    };
  },
});

// ─── league_format_status ────────────────────────────────────────────────────

export const leagueFormatStatus = defineRunnable('season', {
  name: 'league_format_status',
  class: 'R',
  description:
    'Say whether a league has a Format Studio format attached and which version: engine, frozen date, number of amendments and how many of its phases were created by hand instead of by the format. A custom-format league needs an attached format before its first round.',
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 3,
  guard: (args) => ({ kind: 'season', id: args.league_id }),
  output: z.strictObject({
    attached: z.boolean(),
    definition_id: id().nullable(),
    version_no: z.number().int().nullable(),
    engine: z.enum(['legacy', 'shadow', 'kit']).nullable(),
    spec_hash: z.string().regex(/^[0-9a-f]{6,64}$/).nullable(),
    frozen_at: isoDateTime().nullable(),
    amendment_count: z.number().int(),
    manual_phase_count: z.number().int(),
  }),
  async execute(args) {
    const [summary, manual] = await Promise.all([getSeasonFormatSummary(args.league_id), getSeasonManualPhaseCount(args.league_id)]);
    return {
      attached: summary !== null,
      definition_id: summary?.definition_id ?? null,
      version_no: summary?.version_no ?? null,
      engine: summary?.engine ?? null,
      spec_hash: summary?.spec_hash ?? null,
      frozen_at: summary?.frozen_at ?? null,
      amendment_count: summary?.amendments.length ?? 0,
      manual_phase_count: manual,
    };
  },
});

export const FORMAT_READERS = [formatList, formatGet, attachableFormats, leagueFormatStatus] as const;
