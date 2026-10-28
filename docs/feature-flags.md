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

## Kale Policy
Kale remains in the codebase for legacy report testing, but it is disabled by default. Do not build new product workflows on Kale without a new approval decision. The admin page at `/admin/kale` is clearly marked as soft-deprecated, and hard removal requires a later decision after replacement reporting paths are verified.

## Cast Studio Realtime
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is not a feature flag, but it is intentionally public for Cast Studio Supabase Realtime broadcasts. Browser Supabase usage is scoped to `src/lib/supabase/realtime-client.ts` and `src/lib/broadcast/channel.ts`; all database writes still go through API routes.