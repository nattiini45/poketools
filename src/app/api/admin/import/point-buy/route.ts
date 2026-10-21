import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  bindSeasonToList,
  bulkCreateListEntries,
  createListVersion,
  isVersionBoundToActiveSeason,
} from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  pointBuyEntriesToRows,
  validatePointBuyImport,
  type PointBuyImportReport,
} from '@/lib/import/point-buy-xlsx';
import { fileToBuffer, assertXlsxMagicBytes, validateXlsxFile } from '@/lib/import/xlsx-upload';
import { supabase } from '@/lib/supabase/client';
import { expirePublicTags, expireSeasonReads, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { PointBuyListEntryFormData } from '@/types/point-buy';

interface ImportResponse {
  report: PointBuyImportReport;
  dry_run: boolean;
}

/**
 * POST /api/admin/import/point-buy
 * Import point-buy list from xlsx. Multipart fields:
 * - file: .xlsx workbook
 * - name: list name
 * - version: integer version
 * - season_id (optional): bind after import
 * - dry_run (optional): "true" to preview only
 *
 * The response's `report.reconciliation` is the list reconciliation report
 * (src/lib/draft/reconciliation-report.ts); render it with `renderReconciliationMarkdown`.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<ImportResponse>>> {
  try {
    await requireAdmin();

    const formData = await request.formData();
    const file = formData.get('file');
    const name = String(formData.get('name') ?? '').trim();
    const versionRaw = String(formData.get('version') ?? '1');
    const seasonIdRaw = formData.get('season_id');
    const seasonId = seasonIdRaw ? String(seasonIdRaw).trim() : undefined;
    const dryRun = formData.get('dry_run') === 'true';

    if (!name) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'name is required', code: 'import_name_required' },
        { status: 400 }
      );
    }
    const version = parseInt(versionRaw, 10);
    if (!Number.isFinite(version) || version <= 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'version must be a positive integer', code: 'import_version_invalid' },
        { status: 400 }
      );
    }
    if (seasonId) {
      await requireResourceAdmin('season', seasonId);
    }

    const fileErr = validateXlsxFile(file instanceof File ? file : null);
    if (fileErr) {
      return NextResponse.json<ApiResult<never>>({ success: false, ...fileErr }, { status: 400 });
    }

    const buffer = await fileToBuffer(file as File);
    const magicErr = assertXlsxMagicBytes(buffer);
    if (magicErr) {
      return NextResponse.json<ApiResult<never>>({ success: false, ...magicErr }, { status: 400 });
    }
    // The report carries the reconciliation artifact (line ids, price tabs, branched bases, the format
    // pack's league overrides against the sheet values, rule conflicts) on every run, dry or live.
    const { report, validEntries } = await validatePointBuyImport(buffer, { source: (file as File).name });

    if (report.errors.length > 0) {
      return NextResponse.json({ success: true, data: { report, dry_run: true } });
    }

    if (dryRun) {
      return NextResponse.json({ success: true, data: { report, dry_run: true } });
    }

    const { data: existing, error: findErr } = await supabase
      .from('point_buy_list_versions')
      .select('id')
      .eq('name', name)
      .eq('version', version)
      .maybeSingle();
    if (findErr) throw findErr;

    let versionId: string;
    if (existing) {
      versionId = existing.id;
      if (await isVersionBoundToActiveSeason(versionId)) {
        throw new UserFacingError(
          `"${name}" v${version} is bound to an active or completed season — bump version to import a new snapshot.`,
          { code: 'list_version_immutable', status: 409 }
        );
      }
    } else {
      const created = await createListVersion({ name, version, source: (file as File).name });
      versionId = created.id;
    }
    report.version_id = versionId;

    const entryRows: PointBuyListEntryFormData[] = pointBuyEntriesToRows(versionId, validEntries).map((r) => ({
      line_number: r.line_number,
      line_id: r.line_id,
      base_pokemon: r.base_pokemon,
      stage2_pokemon: r.stage2_pokemon,
      stage3_pokemon: r.stage3_pokemon,
      price: r.price,
      kills_to_stage2: r.kills_to_stage2,
      additional_kills_to_stage3: r.additional_kills_to_stage3,
      price_group: r.price_group as PointBuyListEntryFormData['price_group'],
      early_rating: r.early_rating,
      mid_rating: r.mid_rating,
      late_rating: r.late_rating,
      rationale: r.rationale,
      historical_data: r.historical_data,
      special_rules: r.special_rules as PointBuyListEntryFormData['special_rules'],
      special_rules_text: r.special_rules_text,
      sources: r.sources,
      legacy_tier: r.legacy_tier,
      species_ids: r.species_ids,
    }));

    report.imported = await bulkCreateListEntries(versionId, entryRows);
    // The league matchup page reads this version's entries from the public read cache.
    expirePublicTags([publicTags.pointBuyList(versionId)]);

    if (seasonId) {
      const season = await getSeasonById(seasonId);
      if (!season) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Season not found', code: 'season_not_found' },
          { status: 404 }
        );
      }
      if (
        season.point_buy_list_id &&
        season.point_buy_list_id !== versionId &&
        season.status !== 'upcoming'
      ) {
        report.warnings.push(
          `Season is ${season.status} and already bound to a different list — not rebound.`
        );
      } else {
        await bindSeasonToList(seasonId, versionId);
        // The league row names its list version (as on PATCH /api/seasons/[id]).
        expireSeasonReads(seasonId);
      }
    }

    return NextResponse.json({ success: true, data: { report, dry_run: false } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import point-buy list');
  }
}
