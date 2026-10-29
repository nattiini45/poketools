# Feature Flags

## Overview
Feature flags are centralized in `src/lib/feature-flags.ts`. Public flags use the `NEXT_PUBLIC_` prefix because they may be read by server components, route code, and client components.

## Flags

| Flag | Default | Purpose | Status |
|------|---------|---------|--------|
| `NEXT_PUBLIC_ENABLE_KALE_CABBAGE` | `false` | Shows and triggers legacy Kale Cabbage tournament report surfaces | Soft-deprecated |
| `NEXT_PUBLIC_PWA_ENABLED` | `false` | Enables service worker registration | Active |
| `NEXT_PUBLIC_PWA_CACHE_LEVEL` | `shell` | Reserved for future PWA cache tiers (`shell`, `read`, `sync`); not read by the code yet | Reserved |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (+ `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) | unset | Web Push for draft turn alerts: all three set and valid enables it, otherwise the server sends nothing and the draft room hides the push control ([`push.md`](./push.md)) | Active |
| `NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT` | `false` | Shows the Admin Assistant UI (admin nav item; the drawer and `/admin/assistant` as they ship). UI only: the server switch `ADMIN_AGENT_ENABLED` and the route guards are the real gate | Planned (P0 flag) |

## Admin Assistant
The assistant (spec section 18, `docs/poketools-spec.md`) is off unless both switches are set, and every setting fails closed. Only `NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT` lives in `src/lib/feature-flags.ts`; the server settings are parsed in `src/lib/ai/admin-agent/env.ts` (`parseAdminAgentEnv`), the nav item is shown by `agentEnabledFor` in the admin layout, and `src/instrumentation.ts` runs `assertAdminAgentBootEnv` beside `assertBootEnv`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_AGENT_ENABLED` | off | Server kill switch: every assistant route answers 404 while it is off |
| `ADMIN_AGENT_GOLIVE` | off | Lets the approve route run Go-live (G tier) proposals; never on while the assistant is off |
| `ADMIN_AGENT_ROLES` | `site` | Audience: `site` (site admins) or `any` (also league and tournament admins) |
| `ADMIN_AGENT_ALLOWED_PLAYER_IDS` | empty | Comma-separated player UUIDs; empty means everyone in the audience |
| `ADMIN_AGENT_MAX_PHASE` | `0` | Delivery-phase cap `0`-`5`; an invalid value means `0` |
| `ADMIN_AGENT_ALLOW_HOSTED`, `ADMIN_AGENT_LIVE_DB` | unset | Evaluation opt-ins (spec 18.15); `LIVE_DB` is never honoured when `CI` is `true` |
| `ADMIN_AGENT_MODEL_*`, `ADMIN_AGENT_EFFORT_*` | Opus 5.5 / Sonnet 5.5 `medium`, Haiku 5.5 `low` | Model id and effort (`low`, `medium`, `high`) for write, read and small (titles, hints) conversations |
| `ADMIN_AGENT_BUDGET_*_USD` | $5 per conversation (warn at 60%), $20 per admin per day, $120 per admin per month, $80 per day overall | Spending caps in US dollars |
| `ADMIN_AGENT_TURNS_PER_HOUR`, `_WRITES_PER_HOUR`, `_MAX_*`, `_TURN_DEADLINE_SECONDS`, `_CONTEXT_REFUSE_PERCENT` | 40, 60, spec 18.10 limits | Rate limits, per-turn and per-Build limits |
| `ADMIN_AGENT_CAP_*` | 3 leagues, 3 tournaments, 5 rulesets, 8 formats, 6 Go-live executions, 50 pin targets | Blast radius per conversation |
| `ADMIN_AGENT_PROPOSAL_TTL_{BUILD,GOLIVE}_MINUTES` | 60, 15 | Confirmation card lifetime, bounded 5-240 |

Parsing: unset or blank is the default, the string `false` is off, and an invalid value switches the assistant off (an invalid `ADMIN_AGENT_MAX_PHASE` degrades to `0`). With `ADMIN_AGENT_ENABLED` on, an invalid value stops the server at boot and names the key, never the value; with it off, nothing here can stop a boot. All names, defaults and units are in `.env.example`.

## Kale Policy
Kale remains in the codebase for legacy report testing, but it is disabled by default. Do not build new product workflows on Kale without a new approval decision. The admin page at `/admin/kale` is clearly marked as soft-deprecated, and hard removal requires a later decision after replacement reporting paths are verified.

## Cast Studio Realtime
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is not a feature flag, but it is intentionally public for Cast Studio Supabase Realtime broadcasts. Browser Supabase usage is scoped to `src/lib/supabase/realtime-client.ts` and `src/lib/broadcast/channel.ts`; all database writes still go through API routes.