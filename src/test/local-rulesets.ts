/**
 * Seeding and cleaning a ruleset in a LOCAL Supabase stack (the opt-in `*.local.test.ts` files). Never used by the unit
 * tests, which mock the Supabase client.
 *
 * A league pins a ruleset VERSION (`seasons.ruleset_id`, `tournaments.ruleset_id`), so a fixture that needs "a ruleset"
 * inserts a definition and a published version whose id is the id the fixture will pin. The version carries a valid
 * minimal document and its resolved rules (a blank Gen 9 start, no bans), the same shape the publish function writes.
 * Cleaning deletes the definition, which cascades over its versions (and is refused by the database while a league or a
 * trashed league still pins one, exactly like the application).
 */
import { randomUUID } from 'node:crypto';
import { contentHash, type JsonValue } from '@/lib/studio-core/json';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

/** What a query settles to, as the tests' own helpers (`run`, `del`, `attempt`) read it. */
export type LocalResult = { error: { message: string } | null };

/** The minimal slice of a Supabase client these helpers use. */
interface LocalClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<LocalResult>;
    update(row: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<LocalResult> };
    delete(): { eq(column: string, value: string): PromiseLike<LocalResult> };
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<LocalResult & { data: unknown }> } };
  };
}

/** The tests build their own typed clients (deep generics); the helpers take any client and use this slice of it. */
type AnyClient = { from: unknown };

export interface LocalRuleset {
  /** The id of the VERSION: what a league pins. */
  id: string;
  name: string;
  /** Defaults to a new uuid. */
  definitionId?: string;
  /** The league a format attach created the ruleset for (a league-owned, private ruleset); default none (a gallery ruleset). */
  seasonId?: string;
}

/** Inserts a definition with one published version whose id is `input.id`. Resolves with `{ error }` like a query. */
export async function insertLocalRuleset(anyClient: AnyClient, input: LocalRuleset): Promise<LocalResult> {
  const client = anyClient as unknown as LocalClient;
  const definitionId = input.definitionId ?? randomUUID();
  const document = newRulesetDocument(input.name, 'en');
  const resolved = rulesFromBans({ gen: 9, formatKey: 'gen9', clauses: [] });
  const definition = await client.from('ruleset_definitions').insert({
    id: definitionId,
    slug: `lt-${definitionId.replace(/-/g, '').slice(0, 24)}`,
    name: document.identity.name,
    kind: 'custom',
    visibility: input.seasonId === undefined ? 'gallery' : 'private',
    season_id: input.seasonId ?? null,
    current_draft: document,
  });
  if (definition.error) return definition;
  const version = await client.from('ruleset_definition_versions').insert({
    id: input.id,
    definition_id: definitionId,
    version_no: 1,
    schema_version: 1,
    name_text: input.name,
    spec: document,
    resolved,
    content_hash: contentHash(document as unknown as JsonValue),
    resolved_hash: contentHash(resolved as unknown as JsonValue),
    catalog_version: 'test',
    gen: 9,
    format_key: 'gen9',
    is_doubles: false,
  });
  if (version.error) return version;
  return client.from('ruleset_definitions').update({ current_version_id: input.id }).eq('id', definitionId);
}

/** Deletes the definition (and so every version) that the version `versionId` belongs to. */
export async function deleteLocalRuleset(anyClient: AnyClient, versionId: string): Promise<LocalResult> {
  const client = anyClient as unknown as LocalClient;
  const found = await client.from('ruleset_definition_versions').select('definition_id').eq('id', versionId).maybeSingle();
  if (found.error) return found;
  const definitionId = (found.data as { definition_id: string } | null)?.definition_id;
  if (definitionId === undefined) return { error: null };
  return client.from('ruleset_definitions').delete().eq('id', definitionId);
}
