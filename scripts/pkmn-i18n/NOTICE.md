# Third-party notice: PokéAPI data

This is a copy of `src/lib/pkmn/i18n/NOTICE.md`; keep everything below this line identical to it.

The German Pokémon names and game texts in `src/lib/pkmn/i18n/data/` are derived from the PokéAPI data set
(<https://github.com/PokeAPI/pokeapi>, files under `data/v2/csv/`) at commit
`2fe95532d27a9bf340575253aff50868319d8182`, by `scripts/pkmn-i18n/generate.mjs`. These JSON files ship to browsers,
so this notice travels with them; the product credits PokéAPI in the `/wiki` footer.

Derived files:

- `src/lib/pkmn/i18n/data/species.de.json`
- `src/lib/pkmn/i18n/data/moves.de.json`
- `src/lib/pkmn/i18n/data/items.de.json`
- `src/lib/pkmn/i18n/data/abilities.de.json`
- `src/lib/pkmn/i18n/data/misc.de.json`
- `src/lib/pkmn/i18n/data/moves.desc.de.json`
- `src/lib/pkmn/i18n/data/abilities.desc.de.json`
- `src/lib/pkmn/i18n/data/items.desc.de.json`
- `src/lib/pkmn/i18n/data/_meta.json` (source commit and per-CSV sha256)

Names and labels that PokéAPI lacks come from the reviewed tables in `scripts/pkmn-i18n/overrides/` (sources listed in
`scripts/pkmn-i18n/overrides/README.md`), not from PokéAPI.

## PokéAPI license (BSD-3-Clause), verbatim from `LICENSE.md` at the commit above

Copyright (c) © 2013–2023 Paul Hallett and PokéAPI contributors (https://github.com/PokeAPI/pokeapi#contributing). Pokémon and Pokémon character names are trademarks of Nintendo.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

* Neither the name of PokéAPI nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
