/**
 * No-op stub for `next/cache` under tsx (scripts).
 *
 * `revalidatePath` throws "Invariant: static generation store missing"
 * when called outside a Next.js request/build context. Repair-mode script
 * runs (e.g. `npm run audit:seasons -- --repair`) execute the reconcile
 * engine under tsx, where ISR revalidation is meaningless anyway. Scripts
 * map `next/cache` to this stub via `scripts/tsconfig.audit.json` — the
 * same trick the tsconfig already uses for the `server-only` marker.
 * The app build is unaffected: root tsconfig does not reference this file.
 */

export async function revalidatePath(..._args: unknown[]): Promise<void> {
  // Intentional no-op: script runners have no Next.js revalidation runtime.
}

/** Same for tag revalidation (`src/lib/revalidation.ts` expires public reads by tag). */
export function revalidateTag(..._args: unknown[]): void {
  // Intentional no-op: script runners have no Next.js revalidation runtime.
}
