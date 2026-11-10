# Vendored Fluid Functionalism components

Installed from the [Fluid Functionalism](https://www.fluidfunctionalism.com) registry (Radix flavour, MIT, see
`NOTICE.md`) with `npx shadcn@latest add https://www.fluidfunctionalism.com/r/<name>.json` and moved into
`src/components/ui/fluid/`, `src/lib/fluid/` and `src/hooks/fluid/`, with the import paths rewritten to match
(our PascalCase primitives in `src/components/ui/` would collide with the registry's lowercase names). Pages use
them through the wrappers in `src/components/ui/`; never edit these files to change behaviour, wrap them.

Items: springs, use-fluid-hover, size-context, type-scale, shape-context, elevated, reveal, scroll-area, button,
input, textarea, field, select, combobox, checkbox, checkbox-group, radio-group, switch, tabs, dialog, dropdown,
tooltip, table, badge, banner, card, accordion, sidebar, breadcrumb, command-menu (and their registry
dependencies).

The theme variables they read are mapped onto Direction B in `src/app/globals.css` ("Fluid Functionalism
system"). Upstream's global `:focus-visible`, `::selection` and scrollbar rules are not installed.

## Local patches

- `breadcrumb.tsx` (two places) and `sidebar-core.tsx` (two places): the dynamic tag is cast to
  `ComponentType<SlotProps & { ref?: Ref<HTMLElement> }>` instead of `ElementType`. The three.js JSX intrinsic
  elements in this project turn `ElementType`'s props into `never`; the cast changes no runtime behaviour.
- `combobox.tsx`: upstream joins item values with a raw NUL byte inside a string literal; it is written as the
  escape `"\0"` (the same string) because a raw NUL makes git treat the file as binary.

The Tailwind-3 opacity-modifier scan (`tailwind-status-tokens.test.ts`) skips these folders: upstream's `/NN`
modifiers on its own theme colours are new code on Tailwind 4, not a change to an existing surface.

To update an item, re-run the install in a scratch project with the same aliases, move the files the same way,
reapply the patches above and diff.
