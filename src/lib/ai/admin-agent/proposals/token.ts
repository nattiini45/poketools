/**
 * The approval token (plan 4.5 "Expiry, replay, who can approve"): 256 bits, stored only as its sha256, delivered only to
 * the proposing admin by `GET /proposals/[id]` while the proposal is `proposed`, and never written to a message, a tool
 * result or the stream, so the model cannot see or repeat it.
 *
 * Decision: the token is DERIVED, not stored. `HMAC-SHA256(server secret, domain || proposal id || admin id)` is 256 bits,
 * unguessable without the secret, bound to one proposal and one admin, and recomputable by the GET route, which the store
 * could not do for a random token it only keeps the hash of. Staging stores `sha256(token)`; the atomic claim compares it.
 * The secret is the one the session cookies already depend on, so it adds no new asset to protect.
 */
import { createHmac } from 'node:crypto';
import { sha256Hex } from '../plans/hash';

const DOMAIN = 'admin-agent/approval-token/v1';

export function deriveApprovalToken(secret: string, proposalId: string, adminId: string): string {
  if (secret.length < 16) throw new Error('admin-agent: approval token secret is too short');
  return createHmac('sha256', secret).update(`${DOMAIN}\n${proposalId.toLowerCase()}\n${adminId.toLowerCase()}`).digest('hex');
}

/** What the proposals table stores (`token_hash`). */
export const approvalTokenHash = (token: string): string => sha256Hex(token);
