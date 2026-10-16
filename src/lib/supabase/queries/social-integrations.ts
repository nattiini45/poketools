import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { Tables } from '@/types/database';
import type {
  SocialEventType,
  SocialIntegration,
  SocialIntegrationWithSecrets,
  SocialPostOptions,
  SocialProvider,
  SocialScopeType,
} from '@/types/social';
import { DEFAULT_SOCIAL_POST_OPTIONS } from '@/types/social';

type SocialIntegrationRow = Tables<'social_integrations'>;

export interface CreateSocialIntegrationRecord {
  provider: SocialProvider;
  scope_type: SocialScopeType;
  scope_id: string | null;
  label: string;
  event_filter?: SocialEventType[];
  post_options?: Partial<SocialPostOptions>;
  credential_hint?: string | null;
  credentials_encrypted?: string | null;
}

export interface UpdateSocialIntegrationRecord {
  label?: string;
  enabled?: boolean;
  event_filter?: SocialEventType[];
  post_options?: Partial<SocialPostOptions>;
  credential_hint?: string | null;
  credentials_encrypted?: string | null;
}

function mapPostOptions(value: unknown): SocialPostOptions {
  return {
    ...DEFAULT_SOCIAL_POST_OPTIONS,
    ...(value as Partial<SocialPostOptions> ?? {}),
  };
}

function toSocialIntegration(row: SocialIntegrationRow): SocialIntegration {
  return {
    id: row.id,
    provider: row.provider as SocialProvider,
    scope_type: row.scope_type as SocialScopeType,
    scope_id: row.scope_id,
    label: row.label,
    enabled: row.enabled,
    event_filter: (row.event_filter ?? []) as SocialEventType[],
    post_options: mapPostOptions(row.post_options),
    credential_hint: row.credential_hint,
    has_credentials: Boolean(row.credentials_encrypted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toSocialIntegrationWithSecrets(row: SocialIntegrationRow): SocialIntegrationWithSecrets {
  return {
    ...toSocialIntegration(row),
    credentials_encrypted: row.credentials_encrypted,
  };
}

/**
 * Resolve enabled integrations for a tournament write event.
 * Returns tournament-scoped + season-scoped + global integrations.
 */
export async function resolveSocialIntegrations(
  tournamentId: string,
  seasonId: string | null,
): Promise<SocialIntegrationWithSecrets[]> {
  let query = supabase
    .from('social_integrations')
    .select('*')
    .eq('enabled', true);

  const orParts: string[] = ['scope_type.eq.global'];
  if (tournamentId) {
    assertValidUuid(tournamentId, 'tournamentId');
    orParts.push(`and(scope_type.eq.tournament,scope_id.eq.${tournamentId})`);
  }
  if (seasonId) {
    assertValidUuid(seasonId, 'seasonId');
    orParts.push(`and(scope_type.eq.season,scope_id.eq.${seasonId})`);
  }

  query = query.or(orParts.join(','));

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toSocialIntegrationWithSecrets);
}

export async function listAllSocialIntegrations(): Promise<SocialIntegration[]> {
  const { data, error } = await supabase
    .from('social_integrations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toSocialIntegration);
}

export async function getSocialIntegrationById(id: string): Promise<SocialIntegration | null> {
  const { data, error } = await supabase
    .from('social_integrations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toSocialIntegration(data) : null;
}

export async function getSocialIntegrationByIdWithSecrets(
  id: string,
): Promise<SocialIntegrationWithSecrets | null> {
  const { data, error } = await supabase
    .from('social_integrations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toSocialIntegrationWithSecrets(data) : null;
}

export async function createSocialIntegration(
  input: CreateSocialIntegrationRecord,
): Promise<SocialIntegration> {
  const insertData: Partial<SocialIntegrationRow> = {
    provider: input.provider,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    label: input.label,
    event_filter: input.event_filter ?? [],
    post_options: { ...DEFAULT_SOCIAL_POST_OPTIONS, ...(input.post_options ?? {}) },
    credential_hint: input.credential_hint ?? null,
    credentials_encrypted: input.credentials_encrypted ?? null,
  };

  const { data, error } = await supabase
    .from('social_integrations')
    .insert(insertData as SocialIntegrationRow)
    .select('*')
    .single();
  if (error) throw error;
  return toSocialIntegration(data);
}

export async function updateSocialIntegration(
  id: string,
  input: UpdateSocialIntegrationRecord,
): Promise<SocialIntegration> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) update.label = input.label;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (input.event_filter !== undefined) update.event_filter = input.event_filter;
  if (input.post_options !== undefined) {
    const existing = await getSocialIntegrationById(id);
    const merged = {
      ...DEFAULT_SOCIAL_POST_OPTIONS,
      ...(existing?.post_options ?? {}),
      ...input.post_options,
    };
    update.post_options = merged;
  }
  if (input.credential_hint !== undefined) update.credential_hint = input.credential_hint;
  if (input.credentials_encrypted !== undefined) {
    update.credentials_encrypted = input.credentials_encrypted;
  }

  const { data, error } = await supabase
    .from('social_integrations')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return toSocialIntegration(data);
}

export async function deleteSocialIntegration(id: string): Promise<void> {
  const { error } = await supabase
    .from('social_integrations')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

