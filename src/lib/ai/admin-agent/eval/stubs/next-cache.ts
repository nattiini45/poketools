/**
 * `next/cache` for the local-stack eval stages (`scripts/tsconfig.admin-agent-eval.json` maps the specifier here). Outside a
 * Next request the real `revalidatePath` and `revalidateTag` throw "static generation store missing", so the stage routes
 * would fail on their first cache expiry. These record the call instead, which makes "write routes expire their tags"
 * observable (AGENTS.md "Public pages read through the tagged read cache"), and `unstable_cache` is the identity: a route that
 * reads through it reads the database every time.
 */
import { record } from './recorders';

export function revalidatePath(path: string, _type?: 'layout' | 'page'): void {
  record({ channel: 'cache', name: `path:${path}` });
}

export function revalidateTag(tag: string, _profile?: unknown): void {
  record({ channel: 'cache', name: `tag:${tag}` });
}

export function unstable_cache<Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  return fn;
}
