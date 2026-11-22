# Fluid

The vendored [Fluid Functionalism](https://www.fluidfunctionalism.com) registry's support code: the tokens, contexts and motion constants the vendored primitives in `src/components/ui/fluid/` and the hooks in `src/hooks/fluid/` share. Installed with the shadcn registry, import paths rewritten, MIT (`NOTICE.md`); the vendored-fold README lives in `src/components/ui/fluid/README.md` and the paths in `src/lib/design/vendored.ts`. Pages use the primitives through the wrappers in `src/components/ui/` — never edit these files to change behaviour, wrap them ([Design](./design.md)).

## File Structure

```
src/lib/fluid/                     Vendored Fluid support modules (tokens, contexts, motion)
├── type-scale.ts                 typeStyles/typeScale/typeScaleRoles + typeClass/fieldTouchClass text classes
├── font-weight.ts                fontWeights scale tokens
├── shape-context.tsx             ShapeProvider/useShape/usePopupShape/shapeMap/nestedRadius: corner radii hierarchy
├── size-context.tsx              SizeProvider/useSize: component size tiers
├── surface-context.tsx           SurfaceProvider/useSurface: the surface a component renders on
├── surface-classes.ts            SURFACE_BG/SHADOW/HOVER_*: the surface's Tailwind class sets
├── elevated.tsx                  Elevated: the raised-surface wrapper component
├── springs.ts                    spring (fast/…, critically damped) + exitFallbackMs motion constants
├── popup.ts                      popupMotionClass/popupScrollAreaClass/popupViewportClass + POPUP_NAV_KEYS
├── icon-context.tsx              IconComponent/IconName/defaultIcons: the shared icon registry (icon-context)
└── omit.ts                       omit(): object-key filtering helper
```

## Pointers

- [Design](./design.md) ("Fluid primitives") for where the vendored fold sits and how wrappers compose it.
- `src/components/ui/fluid/README.md` for the vendored item list and the regen command.
