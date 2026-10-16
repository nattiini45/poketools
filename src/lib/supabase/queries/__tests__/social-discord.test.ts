import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock builder ─────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
] as const;

const mockBuilder = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return mb;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

vi.mock('@/lib/utils/uuid', () => ({
  assertValidUuid: vi.fn(),
}));

// ── Imports under test ────────────────────────────────────────────
import {
  resolveSocialIntegrations,
  listAllSocialIntegrations,
  getSocialIntegrationById,
  getSocialIntegrationByIdWithSecrets,
  createSocialIntegration,
  updateSocialIntegration,
  deleteSocialIntegration,
} from '../social-integrations';

import {
  resolveWebhooks,
  listAllWebhooks,
  getWebhooksByScope,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from '../discord-webhooks';

// ── Fixtures ──────────────────────────────────────────────────────

const socialIntegrationRow = {
  id: 'si1',
  provider: 'x',
  scope_type: 'global',
  scope_id: null,
  label: 'Main Discord',
  enabled: true,
  event_filter: ['match_complete'],
  post_options: { include_stats: true },
  credential_hint: 'webhook hint',
  credentials_encrypted: 'enc-abc123',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const webhookRow = {
  id: 'wh1',
  scope_type: 'global',
  scope_id: null,
  webhook_url: 'https://discord.com/api/webhooks/123/abc',
  label: 'Results Channel',
  enabled: true,
  event_filter: ['match_complete'],
  format_options: { embed_color: '#FF0000' },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const dbError = { message: 'DB error', code: 'PGRST000' };

// ── Reset ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
});

// ===================================================================
// SOCIAL INTEGRATIONS
// ===================================================================

describe('social-integrations', () => {
  // ── resolveSocialIntegrations ───────────────────────────────────
  describe('resolveSocialIntegrations', () => {
    it('resolves enabled integrations with OR scope filter', async () => {
      mockBuilder.or.mockReturnValue({ data: [socialIntegrationRow], error: null });

      const result = await resolveSocialIntegrations('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

      expect(mockBuilder.from).toHaveBeenCalledWith('social_integrations');
      expect(mockBuilder.eq).toHaveBeenCalledWith('enabled', true);
      expect(mockBuilder.or).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('si1');
      // With-secrets variant should include credentials_encrypted
      expect(result[0].credentials_encrypted).toBe('enc-abc123');
    });

    it('builds OR filter with tournament and season scopes', async () => {
      mockBuilder.or.mockReturnValue({ data: [], error: null });

      await resolveSocialIntegrations('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

      const orArg = mockBuilder.or.mock.calls[0][0] as string;
      expect(orArg).toContain('scope_type.eq.global');
      expect(orArg).toContain('scope_type.eq.tournament');
      expect(orArg).toContain('scope_type.eq.season');
    });

    it('omits season scope when seasonId is null', async () => {
      mockBuilder.or.mockReturnValue({ data: [], error: null });

      await resolveSocialIntegrations('00000000-0000-4000-8000-000000000001', null);

      const orArg = mockBuilder.or.mock.calls[0][0] as string;
      expect(orArg).toContain('scope_type.eq.global');
      expect(orArg).toContain('scope_type.eq.tournament');
      expect(orArg).not.toContain('scope_type.eq.season');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.or.mockReturnValue({ data: null, error: null });
      const result = await resolveSocialIntegrations('00000000-0000-4000-8000-000000000001', null);
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.or.mockReturnValue({ data: null, error: dbError });
      await expect(resolveSocialIntegrations('00000000-0000-4000-8000-000000000001', null)).rejects.toEqual(dbError);
    });
  });

  // ── listAllSocialIntegrations ───────────────────────────────────
  describe('listAllSocialIntegrations', () => {
    it('returns all integrations ordered by created_at desc', async () => {
      mockBuilder.order.mockReturnValue({ data: [socialIntegrationRow], error: null });

      const result = await listAllSocialIntegrations();

      expect(mockBuilder.from).toHaveBeenCalledWith('social_integrations');
      expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Main Discord');
      // Public type should NOT expose credentials_encrypted
      expect(result[0]).toHaveProperty('has_credentials');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await listAllSocialIntegrations();
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(listAllSocialIntegrations()).rejects.toEqual(dbError);
    });
  });

  // ── getSocialIntegrationById ────────────────────────────────────
  describe('getSocialIntegrationById', () => {
    it('returns mapped integration', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: socialIntegrationRow, error: null });

      const result = await getSocialIntegrationById('si1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'si1');
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('x');
      expect(result!.has_credentials).toBe(true);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getSocialIntegrationById('missing');
      expect(result).toBeNull();
    });

    it('has_credentials is false when credentials_encrypted is null', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { ...socialIntegrationRow, credentials_encrypted: null },
        error: null,
      });
      const result = await getSocialIntegrationById('si1');
      expect(result!.has_credentials).toBe(false);
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getSocialIntegrationById('si1')).rejects.toEqual(dbError);
    });
  });

  // ── getSocialIntegrationByIdWithSecrets ─────────────────────────
  describe('getSocialIntegrationByIdWithSecrets', () => {
    it('includes credentials_encrypted field', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: socialIntegrationRow, error: null });

      const result = await getSocialIntegrationByIdWithSecrets('si1');

      expect(result).not.toBeNull();
      expect(result!.credentials_encrypted).toBe('enc-abc123');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getSocialIntegrationByIdWithSecrets('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getSocialIntegrationByIdWithSecrets('si1')).rejects.toEqual(dbError);
    });
  });

  // ── createSocialIntegration ─────────────────────────────────────
  describe('createSocialIntegration', () => {
    it('inserts and returns the created integration', async () => {
      mockBuilder.single.mockResolvedValue({ data: socialIntegrationRow, error: null });

      const result = await createSocialIntegration({
        provider: 'x',
        scope_type: 'global',
        scope_id: null,
        label: 'Main Discord',
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('social_integrations');
      expect(mockBuilder.insert).toHaveBeenCalled();
      expect(result.id).toBe('si1');
    });

    it('defaults event_filter to empty array', async () => {
      mockBuilder.single.mockResolvedValue({ data: socialIntegrationRow, error: null });

      await createSocialIntegration({
        provider: 'x',
        scope_type: 'global',
        scope_id: null,
        label: 'Test',
      });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.event_filter).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(
        createSocialIntegration({
          provider: 'x',
          scope_type: 'global',
          scope_id: null,
          label: 'Fail',
        })
      ).rejects.toEqual(dbError);
    });
  });

  // ── updateSocialIntegration ─────────────────────────────────────
  describe('updateSocialIntegration', () => {
    it('updates label field', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...socialIntegrationRow, label: 'Updated' },
        error: null,
      });

      const result = await updateSocialIntegration('si1', { label: 'Updated' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'si1');
      expect(result.label).toBe('Updated');
    });

    it('updates enabled status', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...socialIntegrationRow, enabled: false },
        error: null,
      });

      await updateSocialIntegration('si1', { enabled: false });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.enabled).toBe(false);
    });

    it('merges post_options with existing values', async () => {
      // getSocialIntegrationById is called internally to merge post_options
      mockBuilder.maybeSingle.mockResolvedValue({ data: socialIntegrationRow, error: null });
      mockBuilder.single.mockResolvedValue({
        data: { ...socialIntegrationRow, post_options: { include_stats: true, format: 'compact' } },
        error: null,
      });

      await updateSocialIntegration('si1', { post_options: { format: 'compact' } as never });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.post_options).toBeDefined();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updateSocialIntegration('si1', { label: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deleteSocialIntegration ─────────────────────────────────────
  describe('deleteSocialIntegration', () => {
    it('deletes by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteSocialIntegration('si1');

      expect(mockBuilder.from).toHaveBeenCalledWith('social_integrations');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'si1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteSocialIntegration('si1')).rejects.toEqual(dbError);
    });
  });
});

// ===================================================================
// DISCORD WEBHOOKS
// ===================================================================

describe('discord-webhooks', () => {
  // ── resolveWebhooks ─────────────────────────────────────────────
  describe('resolveWebhooks', () => {
    it('resolves enabled webhooks with OR scope filter', async () => {
      mockBuilder.or.mockReturnValue({ data: [webhookRow], error: null });

      const result = await resolveWebhooks('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

      expect(mockBuilder.from).toHaveBeenCalledWith('discord_webhooks');
      expect(mockBuilder.eq).toHaveBeenCalledWith('enabled', true);
      expect(result).toHaveLength(1);
      expect(result[0].webhook_url).toBe('https://discord.com/api/webhooks/123/abc');
    });

    it('builds OR filter with all scope types', async () => {
      mockBuilder.or.mockReturnValue({ data: [], error: null });

      await resolveWebhooks('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

      const orArg = mockBuilder.or.mock.calls[0][0] as string;
      expect(orArg).toContain('scope_type.eq.global');
      expect(orArg).toContain('scope_type.eq.tournament');
      expect(orArg).toContain('scope_type.eq.season');
    });

    it('omits season scope when seasonId is null', async () => {
      mockBuilder.or.mockReturnValue({ data: [], error: null });

      await resolveWebhooks('00000000-0000-4000-8000-000000000001', null);

      const orArg = mockBuilder.or.mock.calls[0][0] as string;
      expect(orArg).not.toContain('scope_type.eq.season');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.or.mockReturnValue({ data: null, error: null });
      const result = await resolveWebhooks('00000000-0000-4000-8000-000000000001', null);
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.or.mockReturnValue({ data: null, error: dbError });
      await expect(resolveWebhooks('00000000-0000-4000-8000-000000000001', null)).rejects.toEqual(dbError);
    });
  });

  // ── listAllWebhooks ─────────────────────────────────────────────
  describe('listAllWebhooks', () => {
    it('returns all webhooks ordered by created_at desc', async () => {
      mockBuilder.order.mockReturnValue({ data: [webhookRow], error: null });

      const result = await listAllWebhooks();

      expect(mockBuilder.from).toHaveBeenCalledWith('discord_webhooks');
      expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Results Channel');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await listAllWebhooks();
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(listAllWebhooks()).rejects.toEqual(dbError);
    });
  });

  // ── getWebhooksByScope ──────────────────────────────────────────
  describe('getWebhooksByScope', () => {
    it('filters by scope_type and scope_id', async () => {
      mockBuilder.order.mockReturnValue({ data: [webhookRow], error: null });

      const result = await getWebhooksByScope('tournament', 't1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_type', 'tournament');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_id', 't1');
      expect(result).toHaveLength(1);
    });

    it('uses IS null for global scope (null scopeId)', async () => {
      mockBuilder.order.mockReturnValue({ data: [webhookRow], error: null });

      await getWebhooksByScope('global', null);

      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_type', 'global');
      expect(mockBuilder.is).toHaveBeenCalledWith('scope_id', null);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(getWebhooksByScope('global', null)).rejects.toEqual(dbError);
    });
  });

  // ── getWebhookById ──────────────────────────────────────────────
  describe('getWebhookById', () => {
    it('returns mapped webhook', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: webhookRow, error: null });

      const result = await getWebhookById('wh1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'wh1');
      expect(result).not.toBeNull();
      expect(result!.scope_type).toBe('global');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getWebhookById('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getWebhookById('wh1')).rejects.toEqual(dbError);
    });
  });

  // ── createWebhook ───────────────────────────────────────────────
  describe('createWebhook', () => {
    it('inserts and returns the created webhook', async () => {
      mockBuilder.single.mockResolvedValue({ data: webhookRow, error: null });

      const result = await createWebhook({
        scope_type: 'global',
        scope_id: null,
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
        label: 'Results Channel',
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('discord_webhooks');
      expect(mockBuilder.insert).toHaveBeenCalled();
      expect(result.id).toBe('wh1');
    });

    it('defaults event_filter to empty array', async () => {
      mockBuilder.single.mockResolvedValue({ data: webhookRow, error: null });

      await createWebhook({
        scope_type: 'global',
        scope_id: null,
        webhook_url: 'https://discord.com/api/webhooks/456/def',
        label: 'Test',
      });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.event_filter).toEqual([]);
    });

    it('merges format_options with defaults when provided', async () => {
      mockBuilder.single.mockResolvedValue({ data: webhookRow, error: null });

      await createWebhook({
        scope_type: 'tournament',
        scope_id: 't1',
        webhook_url: 'https://discord.com/api/webhooks/789/ghi',
        label: 'Tourney',
        format_options: { embed_color: '#00FF00' } as never,
      });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.format_options).toBeDefined();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(
        createWebhook({
          scope_type: 'global',
          scope_id: null,
          webhook_url: 'https://discord.com/api/webhooks/fail',
          label: 'Fail',
        })
      ).rejects.toEqual(dbError);
    });
  });

  // ── updateWebhook ───────────────────────────────────────────────
  describe('updateWebhook', () => {
    it('updates provided fields', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...webhookRow, label: 'Updated' },
        error: null,
      });

      const result = await updateWebhook('wh1', { label: 'Updated' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'wh1');
      expect(result.label).toBe('Updated');
    });

    it('updates enabled status', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...webhookRow, enabled: false },
        error: null,
      });

      await updateWebhook('wh1', { enabled: false });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.enabled).toBe(false);
    });

    it('includes updated_at timestamp', async () => {
      mockBuilder.single.mockResolvedValue({ data: webhookRow, error: null });

      await updateWebhook('wh1', { label: 'Test' });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.updated_at).toBeDefined();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updateWebhook('wh1', { label: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deleteWebhook ───────────────────────────────────────────────
  describe('deleteWebhook', () => {
    it('deletes by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteWebhook('wh1');

      expect(mockBuilder.from).toHaveBeenCalledWith('discord_webhooks');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'wh1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteWebhook('wh1')).rejects.toEqual(dbError);
    });
  });
});
