import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { getPhaseById } from './league-phases';
import { resolveLeagueWebhooks } from './discord-webhooks';
import { DEFAULT_FORMAT_OPTIONS, type DiscordEventType, type DiscordWebhook, type WebhookFormatOptions } from '@/types/discord';
import type { Tables } from '@/types/database';
import type { CreatePhaseWebhookInput, PhaseDiscordWebhook, UpdatePhaseWebhookInput } from '@/types/phase-integrations';

function toPhaseWebhook(row: Tables<'phase_discord_webhooks'>): PhaseDiscordWebhook {
  return {
    id: row.id, phase_id: row.phase_id, webhook_url: row.webhook_url, label: row.label, enabled: row.enabled,
    event_filter: row.event_filter as DiscordEventType[],
    format_options: { ...DEFAULT_FORMAT_OPTIONS, ...(row.format_options as Partial<WebhookFormatOptions>) },
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function getPhaseWebhooks(phaseId: string): Promise<PhaseDiscordWebhook[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_discord_webhooks').select('*')
    .eq('phase_id', phaseId).order('created_at', { ascending: false }).order('id').range(from, to));
  return rows.map(toPhaseWebhook);
}

export async function getPhaseWebhookById(phaseId: string, id: string): Promise<PhaseDiscordWebhook | null> {
  const { data, error } = await supabase.from('phase_discord_webhooks').select('*').eq('phase_id', phaseId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPhaseWebhook(data) : null;
}

export async function resolvePhaseWebhooks(phaseId: string): Promise<Array<PhaseDiscordWebhook | DiscordWebhook>> {
  const phase = await getPhaseById(phaseId);
  if (!phase) throw new Error('Native webhook phase not found');
  const [own, inherited] = await Promise.all([getPhaseWebhooks(phaseId), resolveLeagueWebhooks(phase.season_id)]);
  return [...own.filter((webhook) => webhook.enabled), ...inherited];
}

export async function createPhaseWebhook(input: CreatePhaseWebhookInput): Promise<PhaseDiscordWebhook> {
  const { data, error } = await supabase.from('phase_discord_webhooks').insert({
    phase_id: input.phase_id, webhook_url: input.webhook_url, label: input.label,
    event_filter: input.event_filter ?? [], format_options: { ...DEFAULT_FORMAT_OPTIONS, ...input.format_options },
  }).select('*').single();
  if (error) throw error;
  return toPhaseWebhook(data);
}

export async function updatePhaseWebhook(current: PhaseDiscordWebhook, input: UpdatePhaseWebhookInput): Promise<PhaseDiscordWebhook | null> {
  const { data, error } = await supabase.from('phase_discord_webhooks').update({
    webhook_url: input.webhook_url, label: input.label, enabled: input.enabled,
    event_filter: input.event_filter,
    updated_at: new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString(),
    ...(input.format_options !== undefined ? { format_options: { ...current.format_options, ...input.format_options } } : {}),
  }).eq('id', current.id).eq('phase_id', current.phase_id).eq('updated_at', current.updated_at).select('*').maybeSingle();
  if (error) throw error;
  return data ? toPhaseWebhook(data) : null;
}

export async function deletePhaseWebhook(current: PhaseDiscordWebhook): Promise<boolean> {
  const { data, error } = await supabase.from('phase_discord_webhooks').delete()
    .eq('id', current.id).eq('phase_id', current.phase_id).eq('updated_at', current.updated_at).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}
