import 'server-only';
/**
 * `guardFor`: the one place a read tool turns its declared guard into the route's real `require*` helper (plan 6.1).
 *
 *   `site` -> `requireAdmin`            `any` -> `requireAnyAdmin`
 *   `season` / `tournament` -> `requireResourceAdmin(type, id)`
 *   `draft` -> `requireDraftAdmin(id)`   `formatViewer` -> `requireFormatViewer(id)`
 *   `rulesetViewer` / `rulesetOwner` -> `requireRulesetViewer(id)` / `requireRulesetOwner(id)`
 *   `rulesetUsable` -> `requireAnyAdmin` + `assertRulesetUsable(player, versionId)`
 *
 * Every helper re-reads the player live, so a revocation mid-conversation applies on the next call (never captured at
 * chat start). Reader functions take a `Guarded` token that only this module mints, so a read tool cannot be written
 * without a guard: the type has a private constructor and the one construction site is `mint` below (a static test
 * keeps `new Guarded` out of every other file).
 *
 * The superadmin guard is deliberately not reachable from here: no tool is bound to a superadmin-only action
 * (plan 3.3 registry invariant), and a static test keeps it that way.
 */
import {
  requireAdmin,
  requireAnyAdmin,
  requireDraftAdmin,
  requireFormatViewer,
  requireResourceAdmin,
  type FormatAccess,
} from '@/lib/auth/helpers';
import {
  assertRulesetUsable,
  requireRulesetOwner,
  requireRulesetViewer,
  type RulesetAccess,
} from '@/lib/ruleset-studio/guards';
import type { RulesetDefinitionMeta } from '@/lib/ruleset-studio/library-types';
import type { SessionPlayer } from '@/types/auth';

/** The declared guard of a tool, built from its (already validated) arguments. */
export type GuardSpec =
  | { readonly kind: 'site' }
  | { readonly kind: 'any' }
  | { readonly kind: 'season'; readonly id: string }
  | { readonly kind: 'tournament'; readonly id: string }
  | { readonly kind: 'draft'; readonly id: string }
  | { readonly kind: 'formatViewer'; readonly id: string }
  | { readonly kind: 'rulesetViewer'; readonly id: string }
  | { readonly kind: 'rulesetOwner'; readonly id: string }
  | { readonly kind: 'rulesetUsable'; readonly versionId: string };

export type GuardKind = GuardSpec['kind'];
export type GuardSpecOf<K extends GuardKind> = Extract<GuardSpec, { kind: K }>;

/** What each guard hands back besides the live player. */
interface GuardExtras {
  site: Record<never, never>;
  any: Record<never, never>;
  season: { readonly resourceId: string };
  tournament: { readonly resourceId: string };
  draft: { readonly resourceId: string };
  formatViewer: { readonly format: FormatAccess };
  rulesetViewer: { readonly ruleset: RulesetAccess };
  rulesetOwner: { readonly ruleset: RulesetAccess };
  rulesetUsable: { readonly usable: { definition: RulesetDefinitionMeta; version_no: number } };
}

/**
 * Proof that the matching `require*` helper just passed for the live player. Minted only by `guardFor`.
 */
export class Guarded<K extends GuardKind = GuardKind> {
  private constructor(
    readonly kind: K,
    /** The LIVE player the guard returned (never the session copy). */
    readonly player: SessionPlayer,
    extras: GuardExtras[K],
  ) {
    Object.assign(this, extras);
  }
}

/** The token's fields as a reader sees them: the live player plus what its guard returned. */
export type GuardedAs<K extends GuardKind> = Guarded<K> & GuardExtras[K];

type GuardedCtor = new <K extends GuardKind>(kind: K, player: SessionPlayer, extras: GuardExtras[K]) => Guarded<K>;

/** The only construction site of `Guarded`. */
function mint<K extends GuardKind>(kind: K, player: SessionPlayer, extras: GuardExtras[K]): GuardedAs<K> {
  return new (Guarded as unknown as GuardedCtor)(kind, player, extras) as GuardedAs<K>;
}

/**
 * Runs the real guard of `spec` and mints the token. Throws what the guard throws (`AuthError`, `UserFacingError`,
 * `RulesetStudioError`, `FormatStudioError`); `toolErrorFromThrown` maps those to catalogued codes.
 */
export async function guardFor<K extends GuardKind>(spec: GuardSpecOf<K>): Promise<GuardedAs<K>>;
export async function guardFor(spec: GuardSpec): Promise<GuardedAs<GuardKind>> {
  switch (spec.kind) {
    case 'site':
      return mint('site', await requireAdmin(), {});
    case 'any':
      return mint('any', await requireAnyAdmin(), {});
    case 'season':
      return mint('season', await requireResourceAdmin('season', spec.id), { resourceId: spec.id });
    case 'tournament':
      return mint('tournament', await requireResourceAdmin('tournament', spec.id), { resourceId: spec.id });
    case 'draft':
      return mint('draft', await requireDraftAdmin(spec.id), { resourceId: spec.id });
    case 'formatViewer': {
      const format = await requireFormatViewer(spec.id);
      return mint('formatViewer', format.player, { format });
    }
    case 'rulesetViewer': {
      const ruleset = await requireRulesetViewer(spec.id);
      return mint('rulesetViewer', ruleset.player, { ruleset });
    }
    case 'rulesetOwner': {
      const ruleset = await requireRulesetOwner(spec.id);
      return mint('rulesetOwner', ruleset.player, { ruleset });
    }
    case 'rulesetUsable': {
      const player = await requireAnyAdmin();
      const usable = await assertRulesetUsable(player, spec.versionId);
      return mint('rulesetUsable', player, { usable });
    }
  }
}
