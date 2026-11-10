/**
 * Fluid Functionalism (@fluid) components and systems, installed from the registry by `shadcn add` and never edited
 * except for the type casts listed in src/components/ui/fluid/README.md (docs/design.md, "Fluid primitives").
 * Pages use them through the wrappers in src/components/ui; the repo's guards that would rewrite upstream code
 * (React Compiler lint rules, the duration guard, the i18n literal check) skip them. Paths are relative to src/.
 */
export const VENDORED_FLUID_PATHS = ['components/ui/fluid/', 'lib/fluid/', 'hooks/fluid/'] as const;

export function isVendoredFluidSource(pathFromSrc: string): boolean {
  return VENDORED_FLUID_PATHS.some((dir) => pathFromSrc.startsWith(dir));
}
