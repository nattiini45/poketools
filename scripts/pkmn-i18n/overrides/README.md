# Reviewed overrides for the German Pokémon data

`generate.mjs` applies these tables on top of PokeAPI (design: the Pokémon localisation spec,
maintainer-only; not in this repo). Keys are @pkmn ids (`toID` from `src/lib/pkmn/i18n/id.ts`, e.g. `taurospaldeacombat`). A `_comment` key is
ignored. After any edit:

```bash
node scripts/pkmn-i18n/generate.mjs          # regenerate src/lib/pkmn/i18n/data/*
node scripts/pkmn-i18n/generate.mjs --check  # must print "up to date"
npx vitest run src/lib/pkmn/i18n scripts/pkmn-i18n
```

The generator refuses to write when an override key matches no id in the app's universe (stale or misspelt row) or
when a NatDex id has neither a German name nor an allowlist row. `coverage.test.ts` checks the same and that every key
is a real @pkmn id.

| File | Holds | Wins over |
|---|---|---|
| `forms.de.json` | species formes PokeAPI lacks or names inconsistently (Paldea-Tauros, Ogerpon masks, Pikachu caps, Blutmond-Ursaluna, …) | every species rule, including the region rule (`pikachualola`) |
| `abilities.de.json` | the four Embody Aspect variants (@pkmn splits one PokeAPI ability per Ogerpon mask) | PokeAPI ability names |
| `items.de.json` | item names (empty slot) | PokeAPI item names |
| `misc.de.json` | short stat labels, status names and abbreviations, weather words (no PokeAPI German source) | — |
| `desc.de.json` | German game texts keyed `move:<id>`, `ability:<id>`, `item:<id>` (empty slot for official Scarlet/Violet texts) | PokeAPI flavour text |
| `fallback-allowlist.json` | ids allowed to have no German name, each with a reason; never a Gen 9 id | — |

## Rules for new rows

- Use the official German name as the games and pokewiki.de print it. Forme labels go in parentheses after the base
  name, the way PokeAPI writes them ("Wolwerock (Zwielicht)"). Regional formes are `<Region>-<base>` ("Alola-Vulnona").
- Spelling follows pokewiki.de, e.g. "Gefechtvariante" (no s).
- Rows marked **R** in design §1.5 (Ogerpon Tera condensation, Quajutsu (Freundschaftsakt), Wuffels (Zwielicht),
  Zacian/Zamazenta crowned, Zarude (Papa), the Embody Aspect suffixes, the short stat labels, the weather words) await
  the league organiser's and the maintainers' review (open question N3); change them here once decided.
- Description overrides are typed in from the games. Keep the in-game wording; do not translate English text.

## Sources consulted (fetched 2026-10-09)

pokewiki.de pages: Tauros, Ogerpon, Nigiragi, Necrozma, Krawalloro, Pikachu, Delfinator, Dummimisel, Gierspenst,
Famieps, Quajutsu, Meteno, Psiaugon, Ursaluna, Statusproblem. PokeAPI form labels for Mortcha, Fatalitcha, Terapagos.
