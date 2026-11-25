# Motion

The single numeric source for every animation in the app: the duration/easing/offset tokens and the route-change cross-fade. Pure data with no client-only imports, so server components, the `motion` presets in `src/components/shared/motion.tsx` and the Three.js route worlds all read the same constants. Documented in [Design](./design.md) § Motion Tokens; the vendored Fluid spring constants live in `src/lib/fluid/springs.ts` ([Fluid](./fluid.md)).

## File Structure

```
src/lib/motion/
├── tokens.ts             # DURATION / EASE / OFFSET: the motion tokens every animation reads
└── page-transition.ts    # pageTransition(): the route-change cross-fade, reduced-motion aware
```

## Core Functions/Classes

- **`tokens.ts`** — durations are seconds (the unit the `motion` library takes), easing curves are cubic-bezier control points. The CSS duration guard in `motion-guards.test.ts` keeps stylesheets on the same scale.
- **`pageTransition()`** (`page-transition.ts`) — the route-change cross-fade. Under reduced motion only the opacity moves: content stays legible and the change stays visible, without vertical travel.

## Testing

The module is pinned through `src/lib/design/__tests__/` (the frozen-surface and motion guards) and `scripts/design/check-design-guards.mts`; it has no suite of its own.

## Related Modules

- [Design](./design.md) — the design system the tokens belong to.
- [Fluid](./fluid.md) — the vendored springs and motion constants of the Fluid primitives.
- [Worlds](./worlds.md) — the route worlds read the same tokens.
