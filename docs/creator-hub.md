# Creator Hub Module

## Overview
The Creator Hub is a dedicated sub-homepage for content creators at `/creator`. It provides access to the Cast Studio, Wiki, and Overlay Manager. Auth-gated for most features, with wiki pages being public.

## File Structure
```
src/app/creator/
├── layout.tsx              # Shared layout with CreatorNav (soft auth via getSessionPlayer)
├── page.tsx                # Hub homepage: quick actions, recent sessions, overlay gallery
├── studio/                 # Cast Studio (see cast-studio.md)
├── wiki/                   # Wiki pages (public, see wiki.md)
│   └── layout.tsx          # Public wiki layout (no auth)
└── overlays/
    └── page.tsx            # Overlay manager (placeholder)
src/components/creator/
├── CreatorNav.tsx           # Tab navigation: Studio, Wiki, Overlays
├── QuickActions.tsx         # Quick action cards (new session, browse wiki, manage overlays)
├── RecentSessions.tsx       # Recent cast sessions list (placeholder)
└── OverlayGallery.tsx       # Saved overlay presets display (placeholder)
```

## Auth Model
- `/creator` layout: soft auth (`getSessionPlayer()`) — shows CTA if not logged in
- `/creator/wiki/*`: PUBLIC (no auth, SSR, SEO-friendly)
- `/creator/studio/*`: `requireCreator()` — creator/admin role required
- `/creator/overlays`: `requireCreator()`

## Routing
| Path | Auth | Description |
|------|------|-------------|
| `/creator` | Soft | Hub homepage |
| `/creator/studio` | Creator | Session picker |
| `/creator/studio/[id]` | Creator | Active cast session |
| `/creator/studio/[id]/tools` | Creator | Second-screen tools |
| `/creator/studio/[id]/solo` | Creator | Solo streamer layout |
| `/creator/wiki` | Public | Wiki browser |
| `/creator/wiki/pokemon/[name]` | Public | Pokémon entry |
| `/creator/wiki/moves/[name]` | Public | Move entry |
| `/creator/wiki/items/[name]` | Public | Item entry |
| `/creator/wiki/abilities/[name]` | Public | Ability entry |
| `/creator/wiki/tera/[type]` | Public | Tera type entry |
| `/creator/overlays` | Creator | Overlay manager |

## Dependencies
- [Auth Module](./auth.md) — `getSessionPlayer()`, `requireCreator()`
- [Cast Studio Module](./cast-studio.md) — studio pages and components
- [Wiki Module](./wiki.md) — wiki pages and components
- [Broadcast Module](./broadcast.md) — overlay presets

## Related Modules
- [Cast Studio](./cast-studio.md)
- [Wiki](./wiki.md)
- [Broadcast](./broadcast.md)
