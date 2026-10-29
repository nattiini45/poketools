/**
 * The small pieces under the repositories: the admin id brand, the catalogued errors and their database mapping, the
 * payload hygiene guard.
 */
import { describe, expect, it } from 'vitest';
import { errorsAdminAssistant } from '@/i18n/messages/errors/admin-assistant';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  ADMIN_AGENT_STORE_ERROR_STATUS,
  AdminAgentStoreDbError,
  AdminAgentStoreError,
  isUniqueViolation,
  mapStoreDbError,
  unwrap,
  unwrapRow,
} from '../errors';
import { adminIdOf, assertAdminId, isAdminId } from '../ids';
import { assertMessageContentAllowed, assertPayloadAllowed, findForbiddenMessageContent, findForbiddenPayload } from '../payload-guard';

describe('AdminId', () => {
  it('accepts a player UUID, lower-cases it and refuses anything else', () => {
    expect(adminIdOf('11111111-1111-4111-8111-11111111ABCD')).toBe('11111111-1111-4111-8111-11111111abcd');
    for (const bad of ['', 'not-a-uuid', '11111111-1111-4111-8111', 'drop table']) {
      expect(isAdminId(bad)).toBe(false);
      expect(() => adminIdOf(bad)).toThrow(TypeError);
      expect(() => assertAdminId(bad)).toThrow(TypeError);
    }
    expect(isAdminId(undefined)).toBe(false);
    expect(isAdminId(42)).toBe(false);
  });
});

describe('AdminAgentStoreError', () => {
  it('has a catalogued English message and an HTTP status for every code', () => {
    for (const [code, status] of Object.entries(ADMIN_AGENT_STORE_ERROR_STATUS)) {
      expect(Object.prototype.hasOwnProperty.call(errorsAdminAssistant.en, code), code).toBe(true);
      const error = new AdminAgentStoreError(code as keyof typeof ADMIN_AGENT_STORE_ERROR_STATUS);
      expect(error).toBeInstanceOf(UserFacingError);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(status);
      expect(error.message).toBe((errorsAdminAssistant.en as Record<string, string>)[code]);
    }
  });

  it('fills the placeholders and keeps detail and reason off the message', () => {
    const error = new AdminAgentStoreError('agent_cap_reached', { limit: 2 }, { detail: { secret: 'x' }, reason: 'why' });
    expect(error.message).toBe('This conversation has reached its limit of 2 for this kind of change.');
    expect(error.params).toEqual({ limit: 2 });
    expect(error.message).not.toContain('x');
    expect(error.detail).toEqual({ secret: 'x' });
    expect(error.reason).toBe('why');
  });
});

describe('database error mapping', () => {
  it('maps the conversation-not-found signal to the catalogued error and keeps anything else as a static db error', () => {
    const notFound = mapStoreDbError('op', { code: 'P0001', message: 'ADMIN_AGENT_CONVERSATION_NOT_FOUND' });
    expect(notFound).toBeInstanceOf(AdminAgentStoreError);
    expect((notFound as AdminAgentStoreError).code).toBe('conversation_not_found');

    const raw = { code: 'P0001', message: 'ADMIN_AGENT_IMMUTABLE', details: '{"table":"x"}' };
    const other = mapStoreDbError('messages.insert', raw);
    expect(other).toBeInstanceOf(AdminAgentStoreDbError);
    expect(other).not.toBeInstanceOf(UserFacingError);
    expect(other.message).toBe('admin-agent store: messages.insert failed (ADMIN_AGENT_IMMUTABLE)');
    expect(other.cause).toBe(raw);
    expect((other as AdminAgentStoreDbError).dbCode).toBe('ADMIN_AGENT_IMMUTABLE');
  });

  it('puts the SQLSTATE in the message for other errors, never the database text', () => {
    const error = mapStoreDbError('x', { code: '23514', message: 'new row violates check constraint "secret_name"' });
    expect(error.message).toBe('admin-agent store: x failed (23514)');
  });

  it('recognises unique violations by constraint or index name', () => {
    const dup = { code: '23505', message: 'duplicate key value violates unique constraint "uq_admin_agent_messages_client_msg"' };
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(dup, 'uq_admin_agent_messages_client_msg')).toBe(true);
    expect(isUniqueViolation(dup, 'admin_agent_actions_step_key')).toBe(false);
    expect(isUniqueViolation({ code: '23514', message: 'x' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('unwrap throws the mapped error and unwrapRow refuses an empty row', () => {
    expect(unwrap('op', { data: 5, error: null })).toBe(5);
    expect(() => unwrap('op', { data: null, error: { code: '42501', message: 'denied' } })).toThrow(AdminAgentStoreDbError);
    expect(unwrapRow('op', { data: { a: 1 }, error: null })).toEqual({ a: 1 });
    expect(() => unwrapRow('op', { data: null, error: null })).toThrow(AdminAgentStoreDbError);
  });
});

describe('payload hygiene', () => {
  it('refuses private keys in a structured payload, at any depth and in any spelling', () => {
    const cases: Array<[unknown, string]> = [
      [{ player: { discord_id: '1' } }, 'player.discord_id'],
      [{ list: [{ ok: 1 }, { authUserId: 'x' }] }, 'list[1].authUserId'],
      [{ webhook_url: 'u' }, 'webhook_url'],
      [{ a: { 'ban-reason': 'x' } }, 'a.ban-reason'],
      [{ password: 'x' }, 'password'],
      [{ is_test_account: false }, 'is_test_account'],
      [{ avatar_config: {} }, 'avatar_config'],
    ];
    for (const [value, path] of cases) {
      expect(findForbiddenPayload(value)).toEqual({ path, kind: 'forbidden_key' });
    }
  });

  it('refuses a webhook URL in any string and a private field name inside a stringified result', () => {
    expect(findForbiddenPayload({ note: 'see https://discord.com/api/webhooks/1/abc' })?.kind).toBe('webhook_url');
    expect(findForbiddenPayload({ note: 'https://discordapp.com/api/v10/webhooks/1/abc' })?.kind).toBe('webhook_url');
    expect(findForbiddenPayload('https://hooks.slack.com/services/T/B/X')?.kind).toBe('webhook_url');
    // Case does not hide one, a second mention of the host further on is still found, and a host alone is not a webhook.
    expect(findForbiddenPayload({ note: 'HTTPS://Discord.com/API/Webhooks/1/abc' })?.kind).toBe('webhook_url');
    expect(findForbiddenPayload({ note: 'discord.com is fine, but discord.com/api/v9/webhooks/2/x is not' })?.kind).toBe('webhook_url');
    expect(findForbiddenPayload({ note: 'join us on discord.com/invite/abc' })).toBeNull();
    expect(findForbiddenPayload({ text: '{"id":"1","discord_id":"99"}' })).toEqual({ path: 'text', kind: 'private_field_in_text' });
    expect(findForbiddenPayload({ text: '{"discordId" : "99"}' })?.kind).toBe('private_field_in_text');
  });

  it('lets ordinary payloads through, including a participant seed and the word password in prose', () => {
    expect(findForbiddenPayload({ seed: 3, name: 'Alice', note: 'reset your password in the UI', tags: ['a', 1, null, true] })).toBeNull();
    expect(findForbiddenPayload(null)).toBeNull();
    expect(findForbiddenPayload('plain text')).toBeNull();
  });

  it('assertPayloadAllowed throws agent_harness_error with the path and kind, never the value', () => {
    let caught: unknown;
    try {
      assertPayloadAllowed('action.args', { deep: { discord_id: 'SECRET-VALUE' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdminAgentStoreError);
    const error = caught as AdminAgentStoreError;
    expect(error.code).toBe('agent_harness_error');
    expect(error.reason).toBe('payload_forbidden');
    expect(error.detail).toEqual({ label: 'action.args', path: 'deep.discord_id', kind: 'forbidden_key' });
    expect(JSON.stringify([error.message, error.detail])).not.toContain('SECRET-VALUE');
  });

  describe('message content', () => {
    it('scans tool inputs, tool results and the admin text, not the model text or thinking', () => {
      const dirty = '{"discord_id":"1"}';
      expect(findForbiddenMessageContent('assistant', [{ type: 'text', text: dirty }])).toBeNull();
      expect(findForbiddenMessageContent('assistant', [{ type: 'thinking', thinking: dirty, signature: 'sig' }])).toBeNull();
      expect(findForbiddenMessageContent('assistant', [{ type: 'redacted_thinking', data: dirty }])).toBeNull();
      expect(findForbiddenMessageContent('assistant', [{ type: 'tool_use', id: 't', name: 'x', input: { discord_id: '1' } }])).toEqual({
        path: 'content[0].input.discord_id',
        kind: 'forbidden_key',
      });
      expect(findForbiddenMessageContent('user', [{ type: 'tool_result', tool_use_id: 't', content: dirty }])).toEqual({
        path: 'content[0].content',
        kind: 'private_field_in_text',
      });
      expect(findForbiddenMessageContent('user', [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: dirty }] }])?.kind).toBe(
        'private_field_in_text',
      );
    });

    it('refuses a pasted webhook URL in the admin text but lets the admin write about fields', () => {
      expect(findForbiddenMessageContent('user', [{ type: 'text', text: 'use https://discord.com/api/webhooks/1/x' }])?.kind).toBe('webhook_url');
      expect(findForbiddenMessageContent('user', 'https://discord.com/api/webhooks/1/x')?.kind).toBe('webhook_url');
      expect(findForbiddenMessageContent('user', [{ type: 'text', text: 'what is "discord_id": for?' }])).toBeNull();
      expect(() => assertMessageContentAllowed('user', [{ type: 'text', text: 'hello' }])).not.toThrow();
      expect(() => assertMessageContentAllowed('user', [{ type: 'text', text: 'https://discord.com/api/webhooks/1/x' }])).toThrow(AdminAgentStoreError);
    });
  });
});
