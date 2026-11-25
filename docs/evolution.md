# Evolution (tracker display helpers)

The client-safe display helpers of the evolution trackers the Evolution Point Buy leagues render: the point-buy price-group labels and roster filtering, the type-matchup payload of a season's current forms, and the STAB effectiveness matrix behind it. The EPB format engine itself — point-buy lists, progress sources, tokens, redraft — lives in [Evolution Point Buy](./evolution-point-buy.md); this module is only what the tracker screens share.

## File Structure

```
src/lib/evolution/
├── point-buy-display.ts    # Price-group display: labels, colours, counts, filter; how the #roster table narrows rows
├── matchup-types.ts        # Client-safe matchup payload types (no @pkmn / dex imports)
├── matchup-payload.ts      # Server-only matchup dex composition: type info + pairwise effectiveness of the given species
└── stab-matrix.ts          # Best STAB effectiveness of an attacker's own types against a defender
```

## Core Functions/Classes

- **`point-buy-display.ts`** — how a stored price group is labelled, coloured, counted and filtered. Labels come from the active format pack (`epb.priceGroups`, `epb.priceTabs`); the roster price-group pills and the table share one filter value.
- **`buildMatchupDexPayload()`** (`matchup-payload.ts`) — server-only: builds type info, species details and pairwise type-effectiveness multipliers for the given species names (typically the current forms on a season's trackers), composed from the existing `dex.ts` helpers — it does not grow `dex.ts`.
- **`matchup-types.ts`** — the client-safe types of that payload, so the tracker components never reach `@pkmn/*`.
- **`stab-matrix.ts`** — the best STAB multiplier an attacker's own types achieve against a defender, as ranked cells (`0x` … `4x`).

## Testing

- **Test Files — `src/lib/evolution/`**: `src/lib/evolution/__tests__/` (1 test file): `point-buy-display.test.ts`.
- **Running Tests**: `npx vitest run src/lib/evolution/__tests__`

## Related Modules

- [Evolution Point Buy](./evolution-point-buy.md) — the EPB format engine.
- [PKMN](./pkmn.md) — the dex helpers the matchup payload composes.
- [Draft room](./draft-room.md) — the pick screen the price-group display serves.
