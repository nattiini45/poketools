/**
 * Types of the stored format library: definitions, published versions, the copy a league freezes when a format is
 * attached to it, and the shapes the library API answers with.
 *
 * Client-safe on purpose: type imports from the kit's client barrel only, no zod, no Supabase, no server-only module.
 * The rows these describe live in `format_definitions`, `format_definition_versions` and `season_formats`
 * (`supabase/migrations/20261024100100_format_definitions.sql`, `20261024100200_season_formats_and_stage_columns.sql`).
 */
import type { BracketType } from '@/types/tournament';
import type { Diagnostic, FormatDefinition, LText, Stage } from '@/lib/format-kit/client';

export const FORMAT_VISIBILITIES = ['private', 'league', 'gallery'] as const;
export type FormatVisibility = (typeof FORMAT_VISIBILITIES)[number];

export const FORMAT_KINDS = ['preset', 'custom'] as const;
export type FormatKind = (typeof FORMAT_KINDS)[number];

export const SEASON_FORMAT_ENGINES = ['legacy', 'shadow', 'kit'] as const;
export type SeasonFormatEngine = (typeof SEASON_FORMAT_ENGINES)[number];

/** `format_definitions` without the draft body (never selected by list or guard reads). */
export interface FormatDefinitionMeta {
  id: string;
  slug: string;
  name: LText;
  description: LText | null;
  kind: FormatKind;
  owner_id: string | null;
  visibility: FormatVisibility;
  forked_from: string | null;
  draft_rev: number;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormatVersionSummary {
  id: string;
  version_no: number;
  schema_version: number;
  content_hash: string;
  changelog: LText | null;
  created_by: string | null;
  created_at: string;
}

export interface FormatVersion extends FormatVersionSummary {
  definition_id: string;
  spec: FormatDefinition;
  status: 'draft' | 'published';
}

export interface FormatDefinitionSummary extends Omit<FormatDefinitionMeta, 'owner_id' | 'current_version_id'> {
  /** Names only, mapped from an explicit two-column embed; never a `players` row. */
  owner: { id: string; name: string } | null;
  current_version: Pick<FormatVersionSummary, 'id' | 'version_no' | 'content_hash' | 'created_at'> | null;
}

/** The shape of the cached gallery shelf: no owner, no draft, nothing private. */
export interface FormatGalleryItem {
  id: string;
  slug: string;
  name: LText;
  description: LText | null;
  kind: FormatKind;
  version_no: number;
  content_hash: string;
  updated_at: string;
}

/** The result of compiling a document. `diagnostics` is capped at 200; `truncated` says it was cut. */
export interface FormatCheck {
  ok: boolean;
  hash: string | null;
  diagnostics: Diagnostic[];
  truncated: boolean;
}

export interface FormatDefinitionDetail {
  definition: FormatDefinitionSummary;
  /** Owner and site admins only. */
  draft: { document: unknown; draft_rev: number } | null;
  /** The latest published version. */
  published: (FormatVersionSummary & { spec: FormatDefinition }) | null;
  /** Newest first, at most 100; owner and site admins only, else empty. */
  versions: FormatVersionSummary[];
  /** Compile of the draft; owner and site admins only. */
  check: FormatCheck | null;
}

/** What a league stores about its attached format, without the spec and the seed. */
export interface SeasonFormatSummary {
  season_id: string;
  definition_id: string | null;
  version_no: number;
  spec_hash: string;
  tunables: Record<string, unknown>;
  engine: SeasonFormatEngine;
  frozen_at: string;
  amendments: unknown[];
}

export interface SeasonFormatRow extends SeasonFormatSummary {
  spec: FormatDefinition;
  seed: string;
}

/** What attach writes into `tournaments.stage_spec`: a frozen copy of one kit stage. */
export interface StageSpecSnapshot {
  v: 1;
  spec_hash: string;
  stage: Stage;
  mapped_bracket_type: BracketType;
}

export type EngineGapCode =
  | 'override_unmapped'
  | 'rr_legs_not_run'
  | 'third_place_not_run'
  | 'edge_select_not_run'
  | 'groups_not_created';

/** A part of the format the engine does not run yet; codes and params only, the UI words them. */
export interface EngineGap {
  code: EngineGapCode;
  stage?: string;
  edge?: string;
  params: Record<string, string | number>;
}
