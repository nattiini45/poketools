# i18n type-machinery cost (critique C13)

Budget: the `Leaves<T>` / `CheckDe` machinery may add at most **+20 %** to
`tsc --noEmit` wall time. Over budget → simplify before any package starts
(drop the per-leaf `CheckDe` messages in favour of `Same<Leaves>` key parity
plus `parity.test.ts` for placeholders).

Command: `npx tsc --noEmit --extendedDiagnostics --incremental false` from the
repo root (TypeScript 5.9.3). The machine is shared and loaded, so wall time is
noisy; `Instantiations` and `Types` are the deterministic proxy.

| Run (2026-10-09, G0-I18N-RT) | Files | Types | Instantiations | Check time | Total time |
|---|---|---|---|---|---|
| Base tree (before `src/i18n`) | 4,407 | 550,457 | 2,014,149 | 35.10 s | 45.68 s |
| Runtime + filled namespaces + all skeletons + the 250-key fixture (`fixtures/big-namespace`, used by `define.typecheck.ts`) | 4,669 | 578,445 | 2,142,415 | 29.00 s | 36.68 s |
| Delta | +262 | +5.1 % | **+6.4 %** | (load noise) | (load noise) |

The file count also includes files other packages added to the working tree
between the two runs. Result: **within budget**; the reference machinery is
kept (with the `I18nCheckError` brand, see `types.ts`).

## Sweep re-measure (S)

Same command, TypeScript 5.9.3, every namespace filled (~5,000 keys).

| Run (2026-10-11, sweep S, HEAD 5d23097a) | Files | Types | Instantiations | Check time | Total time |
|---|---|---|---|---|---|
| Full tree, every namespace filled | 5,116 | 800,442 | 3,871,181 | 61.40 s | 78.57 s |
| Delta vs base tree (2026-10-09) | +709 | +45.4 % | +92.2 % | +74.9 % | +72.0 % |
| Delta vs G0-I18N-RT row (2026-10-09) | +447 | +38.4 % | +80.7 % | (load noise) | (load noise) |

Trace attribution (`tsc --generateTrace`, `checkSourceFile` time by
directory): `src/i18n/messages` 1,166 ms plus the `src/i18n` runtime and tests
366 ms, of 37,496 ms total, **≈ 4.1 %** of check time.

Caveat: the deltas against the 2026-10-09 rows are not an i18n cost. Between
the runs the tree gained ~700 files (the draft tool, the route world, every
translation wave's call sites), and the machine was loaded, so wall time is
noise and Types/Instantiations measure the whole codebase's growth. The trace
attribution is the i18n share: about 4 %, well inside the +20 % budget, so the
reference machinery (`CheckDe` per-leaf messages) stays.

Recommendation: if an exact number is ever needed, run an A/B on one tree on the
measuring desktop: the same HEAD with and without the `CheckDe` per-leaf
checks (swapped for `Same<Leaves>` key parity), comparing `Instantiations` and
check time from `--extendedDiagnostics`.
