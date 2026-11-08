import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS } from '@/lib/format-engine/notifications/types';

const dir = path.join(process.cwd(), 'supabase/migrations');
const SQL = readFileSync(path.join(dir, '20261108090000_format_notifications.sql'), 'utf8');
const CHALLENGES_SQL = readFileSync(path.join(dir, '20261106090000_format_challenges.sql'), 'utf8');

/** The body of the (last) definition of `name` in `sql`, between its `$$` quotes. */
function bodyOf(sql: string, name: string): string {
  const all = [...sql.matchAll(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\([\s\S]*?\$\$([\s\S]*?)\$\$;`, 'g'))];
  expect(all.length, name).toBeGreaterThan(0);
  return all[all.length - 1][1].replace(/\r\n/g, '\n');
}

describe('20261108090000_format_notifications.sql', () => {
  it('keeps the table to the service role, with RLS on and no policy', () => {
    expect(SQL).toContain('ALTER TABLE public.format_notifications ENABLE ROW LEVEL SECURITY;');
    expect(SQL).toContain('REVOKE ALL ON TABLE public.format_notifications FROM PUBLIC, anon, authenticated;');
    expect(SQL).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_notifications TO service_role;');
    expect(SQL).not.toMatch(/CREATE POLICY/i);
  });

  it('allows exactly the kinds the inbox can show', () => {
    const list = /format_notifications_kind_check CHECK \(\s*kind IN \(([^)]*)\)/.exec(SQL)?.[1] ?? '';
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('makes one notification per recipient and event', () => {
    expect(SQL).toContain('CONSTRAINT format_notifications_dedupe UNIQUE (player_id, dedupe_key)');
    expect(SQL.match(/ON CONFLICT ON CONSTRAINT format_notifications_dedupe DO NOTHING/g)).toHaveLength(2);
  });

  it('writes a rule\'s notices only after the event committed as new, keyed to the event, its format and the effect', () => {
    const body = bodyOf(SQL, 'format_fire_event_notify');
    expect(body.indexOf('format_fire_event(')).toBeLessThan(body.indexOf('INSERT INTO public.format_notifications'));
    expect(body).toMatch(/IF NOT public\.format_fire_event\([^)]*\) THEN\s+RETURN false;/);
    expect(body).toContain("'rule:' || p_expected_revision::text || ':' || p_event_key || ':' || (n ->> 'rule') || ':' || (n ->> 'effect')");
    // A recipient deleted since the plan must not roll the event back.
    expect(body).toMatch(/JOIN public\.players pl ON pl\.id = recipient\.id::uuid\s+FOR KEY SHARE OF pl/);
  });

  it('reacts to a challenge on insert and on a status change, and not on a restored row', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_format_challenges_notify AFTER INSERT OR UPDATE OF status ON public\.format_challenges/);
    const body = bodyOf(SQL, 'format_challenges__notify');
    expect(body).toContain("IF NEW.status <> 'open' OR NEW.created_at <> now() THEN RETURN NULL; END IF;");
    expect(body).toContain('IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;');
    expect(body).toContain("'challenge:' || NEW.id::text || ':' || NEW.status");
  });

  it('stores ids and a side for a challenge, never a name', () => {
    const body = bodyOf(SQL, 'format_challenges__notify');
    expect(body).toContain("jsonb_build_object('role', r.role, 'counterparty_id', r.counterparty_id)");
    expect(body).not.toMatch(/\.name\b/);
  });

  // The migration copies this function to add one line: a later fix to the original must not be undone by the copy.
  it('passes a completion fence on to format_fire_event', () => {
    expect(bodyOf(SQL, 'format_fire_event_notify')).toContain('p_expected_revision, p_fence_match, p_fence_confirmed_at) THEN');
  });

  it('changes format_challenge_cancel by exactly the line that names who cancelled', () => {
    const added = "  PERFORM set_config('format.challenge_actor', coalesce(p_player::text, 'admin'), true);\n";
    expect(bodyOf(SQL, 'format_challenge_cancel').replace(added, '')).toBe(bodyOf(CHALLENGES_SQL, 'format_challenge_cancel'));
  });

  it('gives the new functions to the service role only', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION\s+public\.format_fire_event_notify\(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb, uuid, timestamptz\),\s+public\.format_challenges__notify\(\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.format_fire_event_notify\(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb, uuid, timestamptz\)\s+TO service_role;/);
  });
});
