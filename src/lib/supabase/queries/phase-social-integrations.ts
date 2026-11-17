import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { getPhaseById } from './league-phases';
import { resolveLeagueSocialIntegrations, type CreateSocialIntegrationRecord, type UpdateSocialIntegrationRecord } from './social-integrations';
import { DEFAULT_SOCIAL_POST_OPTIONS, type SocialEventType, type SocialPostOptions, type SocialProvider, type SocialIntegrationWithSecrets } from '@/types/social';
import type { Tables } from '@/types/database';
import type { PhaseSocialIntegration, PhaseSocialIntegrationWithSecrets } from '@/types/phase-integrations';

function toPhaseIntegration(row: Tables<'phase_social_integrations'>): PhaseSocialIntegration {
  return {
    id: row.id, phase_id: row.phase_id, provider: row.provider as SocialProvider,
    label: row.label, enabled: row.enabled, event_filter: row.event_filter as SocialEventType[],
    post_options: { ...DEFAULT_SOCIAL_POST_OPTIONS, ...(row.post_options as Partial<SocialPostOptions>) },
    credential_hint: row.credential_hint, has_credentials: Boolean(row.credentials_encrypted),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function getPhaseSocialIntegrations(phaseId: string): Promise<PhaseSocialIntegration[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_social_integrations').select('*')
    .eq('phase_id', phaseId).order('created_at', { ascending: false }).order('id').range(from, to));
  return rows.map(toPhaseIntegration);
}

export async function getPhaseSocialIntegrationById(phaseId: string, id: string): Promise<PhaseSocialIntegration | null> {
  const { data, error } = await supabase.from('phase_social_integrations').select('*').eq('phase_id', phaseId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPhaseIntegration(data) : null;
}

export async function getPhaseSocialIntegrationSecrets(phaseId: string, id: string): Promise<PhaseSocialIntegrationWithSecrets | null> {
  const { data, error } = await supabase.from('phase_social_integrations').select('*').eq('phase_id', phaseId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...toPhaseIntegration(data), credentials_encrypted: data.credentials_encrypted } : null;
}

export async function resolvePhaseSocialIntegrations(phaseId: string): Promise<Array<PhaseSocialIntegrationWithSecrets | SocialIntegrationWithSecrets>> {
  const phase = await getPhaseById(phaseId);
  if (!phase) throw new Error('Native social integration phase not found');
  const [own, inherited] = await Promise.all([
    readAllPages((from, to) => supabase.from('phase_social_integrations').select('*').eq('phase_id', phaseId)
      .eq('enabled', true).order('id').range(from, to)),
    resolveLeagueSocialIntegrations(phase.season_id),
  ]);
  return [...own.map((row) => ({ ...toPhaseIntegration(row), credentials_encrypted: row.credentials_encrypted })), ...inherited];
}

export async function createPhaseSocialIntegration(
  input: Omit<CreateSocialIntegrationRecord, 'scope_type' | 'scope_id'> & { phase_id: string },
): Promise<PhaseSocialIntegration> {
  const { data, error } = await supabase.from('phase_social_integrations').insert({
    phase_id: input.phase_id, provider: input.provider, label: input.label,
    event_filter: input.event_filter ?? [], post_options: { ...DEFAULT_SOCIAL_POST_OPTIONS, ...input.post_options },
    credential_hint: input.credential_hint ?? null, credentials_encrypted: input.credentials_encrypted ?? null,
  }).select('*').single();
  if (error) throw error;
  return toPhaseIntegration(data);
}

export async function updatePhaseSocialIntegration(
  current: PhaseSocialIntegration, input: UpdateSocialIntegrationRecord,
): Promise<PhaseSocialIntegration | null> {
  const { data, error } = await supabase.from('phase_social_integrations').update({
    label: input.label, enabled: input.enabled, event_filter: input.event_filter,
    credential_hint: input.credential_hint, credentials_encrypted: input.credentials_encrypted,
    updated_at: new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString(),
    ...(input.post_options !== undefined ? { post_options: { ...current.post_options, ...input.post_options } } : {}),
  }).eq('id', current.id).eq('phase_id', current.phase_id).eq('updated_at', current.updated_at).select('*').maybeSingle();
  if (error) throw error;
  return data ? toPhaseIntegration(data) : null;
}

export async function deletePhaseSocialIntegration(current: PhaseSocialIntegration): Promise<boolean> {
  const { data, error } = await supabase.from('phase_social_integrations').delete()
    .eq('id', current.id).eq('phase_id', current.phase_id).eq('updated_at', current.updated_at).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}
