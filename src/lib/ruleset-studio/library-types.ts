/**
 * Types of the stored ruleset library: definitions, published versions and the shapes the library API answers with.
 *
 * Client-safe on purpose: type imports only, no zod, no Supabase, no server-only module. The rows these describe live in
 * `ruleset_definitions` and `ruleset_definition_versions` (`supabase/migrations/20261026100000_ruleset_definitions.sql`).
 */
import type { LText } from '@/lib/studio-core/ltext';
import type { ResolvedRules, RulesetDocument } from '@/lib/ruleset-kit/types';
import type { RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { STUDIO_KINDS, STUDIO_VISIBILITIES, type StudioKind, type StudioVisibility } from '@/lib/studio-core/access';

export const RULESET_VISIBILITIES = STUDIO_VISIBILITIES;
export type RulesetVisibility = StudioVisibility;

export const RULESET_KINDS = STUDIO_KINDS;
export type RulesetKind = StudioKind;

/** `ruleset_definitions` without the draft body (never selected by list or guard reads). */
export interface RulesetDefinitionMeta {
  id: string;
  slug: string;
  name: LText;
  description: LText | null;
  kind: RulesetKind;
  owner_id: string | null;
  visibility: RulesetVisibility;
  /** The league a format attach created this ruleset for. */
  season_id: string | null;
  forked_from: string | null;
  draft_rev: number;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RulesetVersionSummary {
  id: string;
  version_no: number;
  schema_version: number;
  name_text: string;
  content_hash: string;
  resolved_hash: string;
  catalog_version: string;
  /** The catalog preset the document is based on (`spec.base.preset`), or null for a blank base. */
  base_preset: string | null;
  gen: number;
  format_key: string;
  is_doubles: boolean;
  changelog: LText | null;
  created_by: string | null;
  created_at: string;
}

export interface RulesetVersion extends RulesetVersionSummary {
  definition_id: string;
  spec: RulesetDocument;
  resolved: ResolvedRules;
}

export interface RulesetDefinitionSummary extends Omit<RulesetDefinitionMeta, 'owner_id' | 'current_version_id'> {
  /** Names only, mapped from an explicit two-column embed; never a `players` row. */
  owner: { id: string; name: string } | null;
  current_version: Pick<RulesetVersionSummary, 'id' | 'version_no' | 'content_hash' | 'created_at' | 'catalog_version' | 'base_preset'> | null;
}

/** The result of compiling a draft. `diagnostics` is capped; `truncated` says it was cut. */
export interface RulesetCheck {
  ok: boolean;
  content_hash: string | null;
  resolved_hash: string | null;
  diagnostics: RulesetDiagnostic[];
  truncated: boolean;
}

export interface RulesetDefinitionDetail {
  definition: RulesetDefinitionSummary;
  /** Owner, league admins of a league-owned ruleset and site admins only. */
  draft: { document: unknown; draft_rev: number } | null;
  /** The latest published version. */
  published: (RulesetVersionSummary & { spec: RulesetDocument; resolved: ResolvedRules }) | null;
  /** Newest first, at most 100; same audience as the draft, else empty. */
  versions: RulesetVersionSummary[];
  /** Compile of the draft; same audience as the draft. */
  check: RulesetCheck | null;
}

/** One league or phase that pins a version of a definition. */
export interface RulesetPinTarget {
  kind: 'season' | 'tournament';
  id: string;
  /** Present for site admins and admins of that league; counts only for everyone else. */
  name?: string;
  season_id: string | null;
  version_id: string;
  version_no: number;
  status: string;
}

/** How many leagues and phases pin a version of a definition, over all its versions (the library cards print it). */
export interface RulesetPinCounts {
  seasons: number;
  tournaments: number;
}

export interface RulesetUsage {
  /** The pins by version number, always present. */
  counts: Array<{ version_no: number; seasons: number; tournaments: number }>;
  /** Named targets, only for the audience that may see them. */
  targets: RulesetPinTarget[] | null;
}

/** The option list of the ruleset pickers: no document, no resolved rules. */
export interface RulesetOption {
  /** The head version id: what a new league or phase pins. */
  id: string;
  definition_id: string;
  name: string;
  is_doubles: boolean;
  gen: number;
  base_format: string;
  version_no: number;
}
