# PokéTools

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Competitive Pokémon league and tournament management platform. Built with Next.js 16 (App Router), TypeScript, Tailwind CSS, and Supabase.

## Features

- **League & Tournament Management** — create leagues, run Swiss / round-robin / single-elimination tournaments with full bracket tracking
- **Draft Leagues** — snake and linear draft engines with timer, pick/ban, and pool management
- **Teambuilder** — import/export Showdown paste, validate sets against rulesets, damage calculator integration
- **Replay Pipeline & Stats** — parse Pokémon Showdown replays, extract battle stats, compute standings and usage aggregates
- **Broadcast & Cast Studio** — real-time overlays for streamers (match, draft, league, player, wiki), BroadcastChannel sync, second-screen tools
- **Creator Hub** — dedicated dashboard for league organizers and casters with quick actions and studio access
- **Wiki / Encyclopaedia** — public, SEO-friendly Pokémon reference pages with community notes
- **Gamification** — achievements, streaks, player signatures, Glicko-2 ratings
- **Avatar Builder** — canvas-based avatar compositing with asset layers and Supabase Storage
- **AI Analysis** — server-side match analysis, tournament reports, and prep scouting (Anthropic SDK)
- **PWA** — installable shell with service worker and offline fallback

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- npm
- Your own [Supabase](https://supabase.com) project, or the Supabase CLI plus Docker for a local stack
- Your own [Discord application](https://discord.com/developers/applications) for OAuth sign-in

## Quick start (local development)

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npx supabase start              # local Postgres, Auth, Storage and REST API
npx supabase db reset           # apply supabase/migrations/ to the local stack
npm run dev                     # http://localhost:3000
```

`npx supabase status -o env` prints the local API URL and keys. The full, current env surface lives in `.env.example`; [docs/supabase-environments.md](docs/supabase-environments.md) covers the local and hosted Supabase options in more detail.

## Self-hosting

PokéTools is self-hosted: every deployment brings its own Supabase project, Discord application and secrets. Nothing in this repository points at a hosted instance.

### 1. Database (Supabase)

- **Local:** `npx supabase start`, then `npx supabase db reset`.
- **Hosted:** create a project, then:

  ```bash
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push
  ```

The migrations in `supabase/migrations/` create the schema, the grants (the `anon` and `authenticated` API roles hold no privilege in `public`; every read and write goes through the app's API routes) and the public Storage buckets `avatars` and `social-images`.

### 2. Discord application

Create an application in the Discord developer portal and add this OAuth2 redirect URL:

```
<NEXTAUTH_URL>/api/auth/callback/discord
```

For local development that is `http://localhost:3000/api/auth/callback/discord`. Copy the client ID and secret into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

Email/password sign-in is optional and needs extra Supabase Auth configuration: see [docs/auth-email-password.md](docs/auth-email-password.md).

### 3. Environment variables

Required:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://<project-ref>.supabase.co`, or `http://127.0.0.1:54321` locally) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key (Realtime broadcasts and Supabase Auth calls only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server only, never expose to the client |
| `NEXTAUTH_SECRET` | Random string for NextAuth session encryption (e.g. `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | The deployment's origin; `http://localhost:3000` for local dev |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Your Discord OAuth application |
| `CRON_SECRET` | Random string that protects `/api/cron/*` |
| `BOOTSTRAP_SECRET` | Random string for the one-time first-run setup below |

Recommended:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public origin used for canonical and Open Graph URLs (and as the share-link fallback). Canonical URLs fall back to `NEXTAUTH_URL`, then Vercel's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then `http://localhost:3000`. Production needs an https origin; a non-https value (other than localhost) is ignored. |
| `SUPERADMIN_DISCORD_ID` / `SUPERADMIN_EMAIL` | The instance operator's Discord user ID or email; that account is treated as admin on every request |
| `FORMAT_PACK` | Which format pack the build uses: unset (your own pack when present, else the example pack), `example` or `private`. Set `private` in Production, so a build that lost your pack fails instead of shipping the example rules. See "Format packs" below. |

Optional features (AI analysis, avatar generation and moderation, social publishing, the 3D world asset bucket, feature flags) have their own variables, all documented in `.env.example`. Runtime flags are described in [docs/feature-flags.md](docs/feature-flags.md).

**Game assets.** The trainer avatar layers (`public/avatar/`) and the Pokémon GLBs (`public/models/draft-room/`) are third-party art and are not part of this repository (see [NOTICE.md](NOTICE.md)). `npm run dev` and `npm run build` generate simple placeholder avatar layers when the real ones are missing, so the avatar builder works out of the box; existing files are never overwritten. If you hold your own copies, place them at those paths, or keep them in a private GitHub repository and set `PRIVATE_ASSETS_REPO` and `PRIVATE_ASSETS_TOKEN` so `prebuild` fetches them. A Vercel production build without a token stops with an error unless `ALLOW_PLACEHOLDER_ASSETS=1`; see `.env.example`. `ALLOW_PLACEHOLDER_ASSETS=1` only waives the art: without your own format pack such a build also ships the example pack (next paragraph).

**Format packs.** League tuning (point budgets, price tiers, token ratios, match points, tiebreakers, draft-clock settings and the rule text players read) comes from a format pack, not from the code. A fresh checkout runs the public **example pack** (`src/format-packs/example/`), whose numbers and rule text are neutral placeholders, not any real league's rules. That is fine for local development, but those numbers are written into the database when you create a point-buy season, so do not run a real league on them. Copy the example pack to `src/format-packs/private/` and edit it; that folder is gitignored, so deliver it to your build yourself (for example from a private repository through `PRIVATE_ASSETS_REPO` and `PRIVATE_ASSETS_TOKEN`, which fetch it at the same path). Set `FORMAT_PACK=private` in Production. Every build logs which pack it uses (`[format-pack] using example pack`), and a production build that falls back to the example pack without `FORMAT_PACK=example` prints a warning. See [docs/format-packs.md](docs/format-packs.md#writing-your-own-pack).

### 4. First run

1. Start the app and sign in once with Discord.
2. While no admin exists yet, make that signed-in player the first admin by sending `POST /api/bootstrap` with the JSON body `{ "secret": "<BOOTSTRAP_SECRET>" }` (for example with `fetch` from the browser console on your deployment), then sign out and back in. The route promotes your existing player row and turns itself off for good as soon as any admin exists.
3. Seed the default rulesets with `POST /api/seed-rulesets`. As an admin, no body is needed. Before any admin exists, set `BOOTSTRAP_MODE_ENABLED=true` and send `{ "secret": "<BOOTSTRAP_SECRET>" }`; set it back to `false` afterwards.

### 5. Scheduled jobs

`vercel.json` declares five crons: `/api/cron/process-aggregates` (every 10 minutes), `/api/cron/auto-confirm` (every 15 minutes), `/api/cron/draft-ticks` (every 10 minutes), `/api/cron/expire-suspensions` (every 15 minutes, lifts timed suspensions whose end has passed) and `/api/cron/refresh-usage-stats` (monthly). Each request must carry `Authorization: Bearer <CRON_SECRET>`; Vercel Cron sends it automatically when `CRON_SECRET` is set. On another host, call the same paths on the same schedule with that header. `auto-confirm` and `process-aggregates` answer with a 5xx status when part of their run failed (for example `auto_confirm_partial_failure` or `aggregate_jobs_stranded`), so alert on non-2xx cron responses; [docs/match.md](docs/match.md) has the runbooks. `draft-ticks` logs a pool whose tick failed (`[cron/draft-ticks]`) and carries on with the others.

### 6. Deployment notes

The app targets Vercel but runs anywhere Next.js 16 runs. Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `X-Robots-Tag: noindex` on API routes) are set in `next.config.mjs`, and `poweredByHeader` is disabled. On your host, consider enabling firewall or bot protection, keeping build logs and source private, and alerting on function 5xx rates, latency regressions and usage spikes.

Upgrading: read the [CHANGELOG](CHANGELOG.md) first. Each release lists its migrations and new environment variables under **Upgrade notes**; apply the migrations before you deploy the new code.

Backups depend on your Supabase plan, and the app's admin export is not a backup. Before you run `supabase db push` against a populated database, take a dump; [docs/operations-backup.md](docs/operations-backup.md) covers the dump recipe, the restore drill and how to write migrations that do not lock busy tables.

## Development

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Production build (Next.js build + type-check)
npm test          # Run unit tests (vitest)
npm run test:watch # Run tests in watch mode
npm run lint      # ESLint only
```

Notes:
- `npm run lint` covers `src/` and `scripts/` and is not bundled into `npm run build`. `npm run typecheck` runs `tsc --noEmit`; `npm run typecheck:example` type-checks against the example format pack, as CI does.
- Vitest seeds dummy Supabase env vars when unset, so unit tests do not require real secrets.

## Project Structure

```
src/
  app/            Next.js App Router (pages + API routes)
  components/     React components by domain
  lib/            Business logic, DB queries, @pkmn wrappers
  types/          TypeScript types (domain + database)
supabase/
  migrations/     SQL migration files
  config.toml     Supabase CLI config
```

See [`AGENTS.md`](AGENTS.md) for architecture and security rules, [`docs/poketools-spec.md`](docs/poketools-spec.md) for the full specification, and [`docs/modules-index.md`](docs/modules-index.md) for detailed module documentation.

## Documentation

### Modules Documentation
A comprehensive module documentation system is available in the `docs/` folder:

- `modules-index.md` - Central index of all modules with cross-referencing
- `module-documentation-template.md` - Standard template for module documentation
- Individual module files, for example `ai.md`, `auth.md`, `avatar.md`, `broadcast.md`, `cast-studio.md`, `creator-hub.md`, `design.md`, `discord.md`, `draft.md`, `gamification.md`, `match.md`, `pkmn.md`, `profile.md`, `rating.md`, `smogon.md`, `social.md`, `supabase.md`, `team.md`, `teambuilder-reference.md`, `tournament.md`, `utils.md` and `wiki.md`; `modules-index.md` lists them all

Each module documentation includes:
- Overview and purpose
- File structure
- Core functions/classes
- Data flows
- Dependencies
- API routes (if applicable)
- Usage examples
- Testing information
- Related modules (cross-referenced)

## PWA

PokéTools includes an installable PWA shell with a service worker and offline fallback page.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_PWA_ENABLED` | Enable service worker registration (`true` or `false`). |
| `NEXT_PUBLIC_PWA_CACHE_LEVEL` | Reserved for future cache tiers (`shell`, `read`, `sync`); not read by the code yet. |

Notes:
- The current PWA scope covers app-shell caching and offline fallback only — no API caching or offline writes.
- Service worker can be disabled instantly by setting `NEXT_PUBLIC_PWA_ENABLED=false`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, code standards, and how to submit a PR. Release history: [CHANGELOG.md](CHANGELOG.md).

## Security and conduct

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

The source code is licensed under the [MIT licence](LICENSE). Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc.; this is an unofficial fan project with no affiliation. Third-party data, fonts, textures and models keep their own terms, and the MIT licence does not cover them: see [NOTICE.md](NOTICE.md).
