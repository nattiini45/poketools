# Bring your own Supabase project

PokéTools does not ship with, or point at, any hosted Supabase project. Every deployment, including a local dev setup, uses its own: either a local stack run by the Supabase CLI or a hosted project you create.

## Option A: local stack (development)

Requires Docker and the Supabase CLI (`npx supabase` works without a global install).

```bash
npx supabase start          # boots Postgres, Auth, Storage and the REST API locally
npx supabase db reset       # applies supabase/migrations/ to the local database
npx supabase status -o env  # prints the local API URL, anon key and service_role key
```

Put the printed values into `.env.local`:

| Variable | Local value |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` from `supabase status` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` from `supabase status` (server only) |

`supabase/config.toml` holds the local stack's settings. It contains no hosted-project values.

## Option B: hosted project

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Link the CLI and push the migrations:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. Copy the project URL (`https://<your-project-ref>.supabase.co`), the anon/publishable key and the service role key from **Project Settings → API** into your environment (`.env.local`, or your host's environment variables).
4. If you enable email/password sign-in, configure Supabase Auth as described in [`auth-email-password.md`](./auth-email-password.md).

## What the migrations set up

- The full `public` schema, its RLS policies and grants (`supabase/migrations/`). The API roles `anon` and `authenticated` hold no privilege in `public`; every table read and write goes through the app's API routes with the service role key. See [`security/anon-match-columns.md`](./security/anon-match-columns.md) for the reasoning and the read-only checks.
- The public Storage buckets `avatars` and `social-images` (`20260608100001_setup_storage_infra.sql`).
- Optional: the 3D route worlds read their assets from `NEXT_PUBLIC_WORLD_ASSETS_URL`. Leaving it blank serves `/models/world` from a local mirror (`public/models/world/`, git-ignored), which only suits local development with a mirrored folder. A fresh clone has no models, so the 3D route world stays on its Lite view. A deployment must publish a world-assets set to a bucket with `scripts/world-assets/` (see `scripts/world-assets/README.md`) and set the URL.

The pre-baseline migration history (maintainers only) is reference-only and is never applied.

## Rules

- Never commit project URLs, refs or keys. `.env.example` uses placeholders only.
- Automated runs (tests, capture harnesses, preview loops) never query a hosted project. Measure query cost against a local stack (`SUPABASE_METER=1`, see `AGENTS.md`).
- Restoring a dump, or regenerating or squashing the baseline, must end by re-running `20261008081402_revoke_anon_private_match_columns.sql` and `20261008081443_close_public_api_roles.sql` (see `AGENTS.md`, Never Do).
- Do not add `@supabase/ssr`: PokéTools uses NextAuth and the existing clients in `src/lib/supabase/`.
