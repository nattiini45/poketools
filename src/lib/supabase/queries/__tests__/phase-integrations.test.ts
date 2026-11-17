import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tables } from '@/types/database';

const q = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };
  const results: Result[] = [];
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  const builder = {
    select: vi.fn(), eq: vi.fn(), or: vi.fn(), order: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(),
    range: vi.fn(next), single: vi.fn(next), maybeSingle: vi.fn(next),
    then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => next().then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.or, builder.order, builder.update, builder.insert, builder.delete]) method.mockReturnValue(builder);
  return { results, builder, from: vi.fn(() => builder), getPhaseById: vi.fn(), resolveLeagueWebhooks: vi.fn(), resolveLeagueSocialIntegrations: vi.fn() };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));
vi.mock('../league-phases', () => q);
vi.mock('../discord-webhooks', () => q);
vi.mock('../social-integrations', () => q);

import { createPhaseWebhook, deletePhaseWebhook, getPhaseWebhookById, resolvePhaseWebhooks, updatePhaseWebhook } from '../phase-discord-webhooks';
import { createPhaseSocialIntegration, deletePhaseSocialIntegration, getPhaseSocialIntegrationById, getPhaseSocialIntegrationSecrets, resolvePhaseSocialIntegrations, updatePhaseSocialIntegration } from '../phase-social-integrations';
import { toPhaseWebhookView } from '@/lib/discord/phase-webhook-view';

const LEAGUE = '00000000-0000-4000-8000-000000000001';
const webhook: Tables<'phase_discord_webhooks'> = {
  id: 'webhook', phase_id: 'phase', webhook_url: 'https://discord.com/api/webhooks/123/fake-fixture-token',
  label: 'Fixture channel', enabled: true, event_filter: ['match_confirmed'], format_options: {}, created_at: 'created', updated_at: '2026-01-01T00:00:00.000Z',
};
const social: Tables<'phase_social_integrations'> = {
  id: 'integration', phase_id: 'phase', provider: 'bluesky', label: 'Fixture account', enabled: true,
  event_filter: ['match_confirmed'], post_options: {}, credential_hint: 'Fixture hint', credentials_encrypted: 'opaque-fixture-bytes',
  created_at: 'created', updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  q.results.length = 0;
  q.getPhaseById.mockResolvedValue({ season_id: LEAGUE });
  q.resolveLeagueWebhooks.mockResolvedValue([]);
  q.resolveLeagueSocialIntegrations.mockResolvedValue([]);
});

describe('native phase integration storage', () => {
  it('masks webhook credentials with a field allowlist', async () => {
    q.results.push({ data: { ...webhook, unexpected_private: 'not-public' }, error: null });
    const stored = await getPhaseWebhookById('phase', webhook.id);
    if (!stored) throw new Error('Missing webhook fixture');
    const view = toPhaseWebhookView(stored);
    expect(view).toMatchObject({ id: webhook.id, phase_id: 'phase', webhook_url_hint: '…oken' });
    expect(view).not.toHaveProperty('webhook_url');
    expect(view).not.toHaveProperty('unexpected_private');
    expect(view).not.toHaveProperty('scope_id');
  });

  it('returns encrypted credentials only through the explicit secrets getter', async () => {
    q.results.push({ data: social, error: null }, { data: social, error: null });
    const publicValue = await getPhaseSocialIntegrationById('phase', social.id);
    expect(publicValue).toMatchObject({ phase_id: 'phase', has_credentials: true, credential_hint: social.credential_hint });
    expect(publicValue).not.toHaveProperty('credentials_encrypted');
    await expect(getPhaseSocialIntegrationSecrets('phase', social.id)).resolves.toMatchObject({ credentials_encrypted: social.credentials_encrypted });
  });

  it('preserves opaque ciphertext exactly when creating a native integration', async () => {
    q.results.push({ data: social, error: null });
    const created = await createPhaseSocialIntegration({ phase_id: 'phase', provider: 'bluesky', label: social.label,
      credentials_encrypted: social.credentials_encrypted });
    expect(q.builder.insert).toHaveBeenCalledWith(expect.objectContaining({ phase_id: 'phase', credentials_encrypted: social.credentials_encrypted }));
    expect(created).not.toHaveProperty('credentials_encrypted');
    q.results.push({ data: webhook, error: null });
    await createPhaseWebhook({ phase_id: 'phase', label: webhook.label, webhook_url: webhook.webhook_url });
    expect(q.builder.insert).toHaveBeenCalledWith(expect.objectContaining({ phase_id: 'phase', webhook_url: webhook.webhook_url }));
  });

  it('guards configuration edits and deletion by the actual phase and captured version', async () => {
    q.results.push({ data: webhook, error: null }, { data: social, error: null });
    const currentWebhook = await getPhaseWebhookById('phase', webhook.id);
    const currentSocial = await getPhaseSocialIntegrationById('phase', social.id);
    if (!currentWebhook || !currentSocial) throw new Error('Missing integration fixtures');
    q.results.push({ data: null, error: null }, { data: null, error: null }, { data: [], error: null }, { data: [], error: null });
    await expect(updatePhaseWebhook(currentWebhook, { enabled: false })).resolves.toBeNull();
    await expect(updatePhaseSocialIntegration(currentSocial, { enabled: false })).resolves.toBeNull();
    await expect(deletePhaseWebhook(currentWebhook)).resolves.toBe(false);
    await expect(deletePhaseSocialIntegration(currentSocial)).resolves.toBe(false);
    expect(q.builder.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(q.builder.eq).toHaveBeenCalledWith('updated_at', webhook.updated_at);
  });

  it('resolves only its actual parent league/global hooks, without a legacy tournament id', async () => {
    q.results.push({ data: [webhook, { ...webhook, id: 'disabled', enabled: false }], error: null }, { data: [], error: null });
    const hooks = await resolvePhaseWebhooks('phase');
    expect(hooks.map((hook) => hook.id)).toEqual(['webhook']);
    expect(q.resolveLeagueWebhooks).toHaveBeenCalledWith(LEAGUE);
    expect(q.builder.eq).toHaveBeenCalledWith('phase_id', 'phase');
    q.results.push({ data: [social], error: null }, { data: [], error: null });
    const integrations = await resolvePhaseSocialIntegrations('phase');
    expect(integrations).toEqual([expect.objectContaining({ phase_id: 'phase', credentials_encrypted: social.credentials_encrypted })]);
    expect(q.resolveLeagueSocialIntegrations).toHaveBeenCalledWith(LEAGUE);
    expect(q.builder.eq).toHaveBeenCalledWith('enabled', true);
  });

  it('fails closed for unknown phases and failed reads', async () => {
    q.getPhaseById.mockResolvedValue(null);
    await expect(resolvePhaseWebhooks('phase')).rejects.toThrow('Native webhook phase not found');
    await expect(resolvePhaseSocialIntegrations('phase')).rejects.toThrow('Native social integration phase not found');
    expect(q.resolveLeagueWebhooks).not.toHaveBeenCalled();
    expect(q.resolveLeagueSocialIntegrations).not.toHaveBeenCalled();
    q.results.push({ data: null, error: new Error('integration read failed') });
    await expect(getPhaseSocialIntegrationById('phase', 'id')).rejects.toThrow('integration read failed');
  });

  it('pages inherited targets and excludes tournament scope from the resolver filter', async () => {
    const discord = await vi.importActual<typeof import('../discord-webhooks')>('../discord-webhooks');
    const integrations = await vi.importActual<typeof import('../social-integrations')>('../social-integrations');
    q.results.push({ data: [], error: null }, { data: [], error: null });
    await discord.resolveLeagueWebhooks(LEAGUE);
    await integrations.resolveLeagueSocialIntegrations(LEAGUE);
    expect(q.builder.or).toHaveBeenCalledWith(`scope_type.eq.global,and(scope_type.eq.season,scope_id.eq.${LEAGUE})`);
    expect(q.builder.range).toHaveBeenCalledWith(0, 999);
    expect(q.from.mock.calls).toEqual([['discord_webhooks'], ['social_integrations']]);
    await expect(discord.resolveLeagueWebhooks('bad')).rejects.toThrow();
  });
});
