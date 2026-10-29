import { defineBinding } from '@/lib/ai/admin-agent/dispatch';
import { definitionParams, presetForkBody, presetParams, rulesetCreateBody, rulesetForkBody } from './schemas';

/**
 * The three modes of `ruleset_create_draft`, one binding each, exactly the routes the tool declares. All are class D: they
 * create a PRIVATE definition owned by the admin (nothing is public, nothing can be pinned until it is published), and the
 * route answers 201 with `{ definition, check }`. The runner turns the answer into ids and a revision; no document goes back
 * to the model. The create limiter (20 per hour) and the 200-ruleset quota are the routes' own and shared with the admin pages.
 */

/** Mode `new`: `POST /api/ruleset-definitions`, from a name and optionally a catalog base preset. */
export interface RulesetNewArgs {
  name: string;
  base_locale: 'en' | 'de';
  base_preset?: string;
  tour_overlay?: boolean;
  slug?: string;
}

export const rulesetCreateNew = defineBinding<RulesetNewArgs>({
  operation: 'ruleset_create_new',
  method: 'POST',
  path: '/api/ruleset-definitions',
  class: 'D',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/route'),
  bodySchema: rulesetCreateBody,
  buildBody: (args) => ({
    name: args.name,
    base_locale: args.base_locale,
    ...(args.base_preset === undefined ? {} : { preset: args.base_preset }),
    ...(args.tour_overlay === undefined ? {} : { tour_overlay: args.tour_overlay }),
    ...(args.slug === undefined ? {} : { slug: args.slug }),
  }),
});

/** Mode `fork_preset`: `POST /api/ruleset-definitions/presets/[presetId]/fork`. */
export interface RulesetForkPresetArgs {
  preset_id: string;
  tour_overlay?: boolean;
  slug?: string;
}

export const rulesetCreateForkPreset = defineBinding<RulesetForkPresetArgs>({
  operation: 'ruleset_create_fork_preset',
  method: 'POST',
  path: '/api/ruleset-definitions/presets/[presetId]/fork',
  class: 'D',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/presets/[presetId]/fork/route'),
  paramsSchema: presetParams,
  bodySchema: presetForkBody,
  buildParams: (args) => ({ presetId: args.preset_id }),
  buildBody: (args) => ({
    ...(args.tour_overlay === undefined ? {} : { tour_overlay: args.tour_overlay }),
    ...(args.slug === undefined ? {} : { slug: args.slug }),
  }),
});

/** Mode `fork_ruleset`: `POST /api/ruleset-definitions/[id]/fork`, a copy of a ruleset the admin may see. */
export interface RulesetForkRulesetArgs {
  source_id: string;
  slug?: string;
}

export const rulesetCreateForkRuleset = defineBinding<RulesetForkRulesetArgs>({
  operation: 'ruleset_create_fork_ruleset',
  method: 'POST',
  path: '/api/ruleset-definitions/[id]/fork',
  class: 'D',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/fork/route'),
  paramsSchema: definitionParams,
  bodySchema: rulesetForkBody,
  buildParams: (args) => ({ id: args.source_id }),
  buildBody: (args) => (args.slug === undefined ? {} : { slug: args.slug }),
});
