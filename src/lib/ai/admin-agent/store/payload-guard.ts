/**
 * Payload hygiene of the store (spec 4.14, plan 4.6 and 6.6): what is never persisted in an `admin_agent_*` column.
 *
 * The R tools project their output through allow-list schemas, so these checks are the backstop that makes a leak a
 * loud failure instead of a stored row: a structured payload (ledger args and results, plan documents, previews, UI
 * projections, snapshots) must carry no key from `FORBIDDEN_KEYS` and no webhook URL, and the tool-facing parts of a
 * message (tool inputs, tool results, the admin's own text) the same, including a private field name inside a
 * stringified JSON tool result. The model's own text and thinking are not scanned: they must replay byte for byte, and a
 * refused assistant message would lose a paid step.
 *
 * Not covered here, by design: `season_formats.seed` and redraft submission lists have no distinctive key (a
 * participant's `seed` is legitimate), so they stay out through the projection of the tools that could read them.
 * Violations carry the path and the kind, never the value.
 */
import { AdminAgentStoreError } from './errors';

/** Keys that never go into a stored payload (normalised: lower case, no `_` or `-`). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'webhookurl',
  'discordwebhook',
  'discordwebhookurl',
  'webhooktoken',
  'password',
  'plaintextpassword',
  'passwordhash',
  'discordid',
  'authuserid',
  'banreason',
  'suspendeduntil',
  'avatarconfig',
  'istestaccount',
  'isadmin',
  'issuperadmin',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'servicerolekey',
  'clientsecret',
  'secret',
  'ipaddress',
  'redraftsubmission',
  'redraftsubmissions',
]);

const normaliseKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '');

/** A private field name written as a JSON key inside a string (`"discord_id":`), in snake or camel case. */
const PRIVATE_KEY_IN_TEXT = (() => {
  const names = [
    'discord_id',
    'auth_user_id',
    'ban_reason',
    'suspended_until',
    'avatar_config',
    'is_test_account',
    'webhook_url',
    'plaintext_password',
    'password',
    'access_token',
    'refresh_token',
    'api_key',
    'service_role_key',
    'client_secret',
  ];
  const camel = names.map((n) => n.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()));
  return new RegExp(`"(?:${[...names, ...camel].join('|')})"\\s*:`, 'i');
})();

/**
 * Whether a string contains a Discord or Slack webhook URL ANYWHERE in it (a pasted URL inside a sentence too): this is a
 * deny-list detector, so it looks for the host and then the webhook path right after it, and never anchors to the start.
 */
function containsWebhookUrl(value: string): boolean {
  const text = value.toLowerCase();
  if (text.includes('hooks.slack.com/services/')) return true;
  for (const host of ['discord.com', 'discordapp.com']) {
    for (let at = text.indexOf(host); at !== -1; at = text.indexOf(host, at + 1)) {
      if (/^\/api(?:\/v\d+)?\/webhooks\//.test(text.slice(at + host.length))) return true;
    }
  }
  return false;
}

/** `not_scanned`: the payload is deeper or larger than the scan walks, so it cannot be cleared. */
export type PayloadViolationKind = 'forbidden_key' | 'webhook_url' | 'private_field_in_text' | 'not_scanned';

export interface PayloadViolation {
  /** Where, as `a.b[2].c` (key names only). */
  path: string;
  kind: PayloadViolationKind;
}

const MAX_DEPTH = 64;
const MAX_NODES = 250_000;

function scan(value: unknown, path: string, depth: number, budget: { nodes: number }, textKeys: boolean): PayloadViolation | null {
  // Fail closed: a payload past the scan's own limits is refused, never waved through unscanned.
  if (budget.nodes-- <= 0 || depth > MAX_DEPTH) return { path, kind: 'not_scanned' };
  if (typeof value === 'string') {
    if (containsWebhookUrl(value)) return { path, kind: 'webhook_url' };
    if (textKeys && PRIVATE_KEY_IN_TEXT.test(value)) return { path, kind: 'private_field_in_text' };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = scan(value[i], `${path}[${i}]`, depth + 1, budget, textKeys);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (FORBIDDEN_KEYS.has(normaliseKey(key))) return { path: childPath, kind: 'forbidden_key' };
      const hit = scan(child, childPath, depth + 1, budget, textKeys);
      if (hit) return hit;
    }
  }
  return null;
}

/** The first violation in a structured payload, or `null`. */
export function findForbiddenPayload(value: unknown): PayloadViolation | null {
  return scan(value, '', 0, { nodes: MAX_NODES }, true);
}

/** The first violation in the tool-facing parts of a message's content blocks, or `null` (see the header). */
export function findForbiddenMessageContent(role: 'user' | 'assistant' | 'system', content: unknown): PayloadViolation | null {
  const budget = { nodes: MAX_NODES };
  if (typeof content === 'string') return scan(content, 'content', 0, budget, role === 'user');
  if (!Array.isArray(content)) return scan(content, 'content', 0, budget, true);
  for (let i = 0; i < content.length; i += 1) {
    const block: unknown = content[i];
    if (typeof block !== 'object' || block === null) continue;
    const { type } = block as { type?: unknown };
    const at = `content[${i}]`;
    if (type === 'tool_use') {
      const hit = scan((block as { input?: unknown }).input, `${at}.input`, 0, budget, true);
      if (hit) return hit;
    } else if (type === 'tool_result') {
      const hit = scan((block as { content?: unknown }).content, `${at}.content`, 0, budget, true);
      if (hit) return hit;
    } else if (type === 'text' && role !== 'assistant') {
      const hit = scan((block as { text?: unknown }).text, `${at}.text`, 0, budget, false);
      if (hit) return hit;
    }
  }
  return null;
}

function refuse(label: string, violation: PayloadViolation): never {
  throw new AdminAgentStoreError('agent_harness_error', undefined, {
    reason: 'payload_forbidden',
    detail: { label, path: violation.path, kind: violation.kind },
  });
}

/** Throws `agent_harness_error` (reason `payload_forbidden`) when a structured payload carries a forbidden key or URL. */
export function assertPayloadAllowed(label: string, value: unknown): void {
  const violation = findForbiddenPayload(value);
  if (violation) refuse(label, violation);
}

/** Throws like `assertPayloadAllowed` for the tool-facing parts of a message. */
export function assertMessageContentAllowed(role: 'user' | 'assistant' | 'system', content: unknown): void {
  const violation = findForbiddenMessageContent(role, content);
  if (violation) refuse('message.content', violation);
}
