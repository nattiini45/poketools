import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { Tables } from '@/types/database';
import type {
  DiscordWebhook,
  DiscordEventType,
  WebhookScopeType,
  WebhookFormatOptions,
  CreateWebhookInput,
  UpdateWebhookInput,
} from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';

type WebhookRow = Tables<'discord_webhooks'>;

function toWebhook(row: WebhookRow): DiscordWebhook {
  return {
    id: row.id,
    scope_type: row.scope_type as WebhookScopeType,
    scope_id: row.scope_id,
    webhook_url: row.webhook_url,
    label: row.label,
    enabled: row.enabled,
    event_filter: (row.event_filter ?? []) as DiscordEventType[],
    format_options: {
      ...DEFAULT_FORMAT_OPTIONS,
      ...(row.format_options as Partial<WebhookFormatOptions> ?? {}),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Resolve all webhooks that should receive an event for a given tournament.
 * Returns: tournament-scoped + season-scoped + global webhooks.
 */
export async function resolveWebhooks(
  tournamentId: string,
  seasonId: string | null
): Promise<DiscordWebhook[]> {
  // Build OR filter: global + tournament + (optionally) season
  let query = supabase
    .from('discord_webhooks')
    .select('*')
    .eq('enabled', true);

  // We need an OR across scope conditions
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
  return (data ?? []).map(toWebhook);
}

/**
 * List ALL webhooks across all scopes. Used by the admin UI.
 */
export async function listAllWebhooks(): Promise<DiscordWebhook[]> {
  const { data, error } = await supabase
    .from('discord_webhooks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toWebhook);
}

export async function getWebhooksByScope(
  scopeType: WebhookScopeType,
  scopeId: string | null
): Promise<DiscordWebhook[]> {
  let query = supabase
    .from('discord_webhooks')
    .select('*')
    .eq('scope_type', scopeType);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toWebhook);
}

export async function getWebhookById(id: string): Promise<DiscordWebhook | null> {
  const { data, error } = await supabase
    .from('discord_webhooks')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toWebhook(data) : null;
}

export async function createWebhook(input: CreateWebhookInput): Promise<DiscordWebhook> {
  const insertData: Partial<WebhookRow> = {
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    webhook_url: input.webhook_url,
    label: input.label,
    event_filter: input.event_filter ?? [],
  };
  if (input.format_options) {
    insertData.format_options = { ...DEFAULT_FORMAT_OPTIONS, ...input.format_options };
  }

  const { data, error } = await supabase
    .from('discord_webhooks')
    .insert(insertData as WebhookRow)
    .select('*')
    .single();

  if (error) throw error;
  return toWebhook(data);
}

export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput
): Promise<DiscordWebhook> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.webhook_url !== undefined) update.webhook_url = input.webhook_url;
  if (input.label !== undefined) update.label = input.label;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (input.event_filter !== undefined) update.event_filter = input.event_filter;
  if (input.format_options !== undefined) update.format_options = input.format_options;

  const { data, error } = await supabase
    .from('discord_webhooks')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return toWebhook(data);
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase
    .from('discord_webhooks')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
