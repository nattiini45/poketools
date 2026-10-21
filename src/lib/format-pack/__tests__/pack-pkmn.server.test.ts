/**
 * Format-pack `@pkmn` ids (design spec §F.3; the Pokémon Data Rules exception in AGENTS.md).
 * Server test: every utility member, line-rule base, hint species and reconciliation id of each
 * present pack (example always, private when the companion overlay is attached) resolves in
 * `@pkmn/dex`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import examplePack from '../../../format-packs/example';
import exampleFixture from '../../draft/__tests__/fixtures/example-list.json';
import type { FormatPack } from '..';

const PRIVATE_ENTRY = path.resolve(__dirname, '../../../format-packs/private/index.ts');
const HAS_PRIVATE = existsSync(PRIVATE_ENTRY);

async function loadPrivatePack(): Promise<FormatPack> {
  const mod: unknown = await import(/* @vite-ignore */ pathToFileURL(PRIVATE_ENTRY).href);
  return (mod as { default: FormatPack }).default;
}

function checkPack(pack: FormatPack) {
  const seen = new Set<string>();
  for (const def of pack.epb.utility.categories) {
    for (const m of def.members) {
      const data = m.kind === 'move' ? Dex.moves.get(m.id) : Dex.abilities.get(m.id);
      expect(data.exists, `${def.key}:${m.id}`).toBe(true);
      expect(data.id, `${def.key}:${m.id}`).toBe(m.id);
      expect(data.isNonstandard ?? null, `${def.key}:${m.id} is nonstandard`).toBeNull();
      expect(seen.has(m.id), `${m.id} is listed twice`).toBe(false);
      seen.add(m.id);
    }
  }
  for (const d of pack.epb.utility.dropped) expect(Dex.moves.get(d.id).exists, d.id).toBe(true);
  for (const rule of pack.epb.lineRules) expect(Dex.species.get(rule.base).exists, rule.base).toBe(true);
  for (const name of pack.draftFormat.hintSpecies) expect(Dex.species.get(name).exists, name).toBe(true);
  for (const name of pack.epb.defaults.bannedMoves) expect(Dex.moves.get(name).exists, name).toBe(true);
  for (const name of pack.epb.defaults.bannedItems) expect(Dex.items.get(name).exists, name).toBe(true);
  for (const id of pack.epb.reconciliation.knownRepoOnlyBanIds) {
    expect(Dex.moves.get(id).exists || Dex.items.get(id).exists, id).toBe(true);
  }
  for (const id of pack.epb.reconciliation.pastStatusHealingIds) expect(Dex.moves.get(id).exists, id).toBe(true);
  for (const marker of Object.values(pack.epb.workbook.utilitySheet.branchMarkers)) {
    for (const name of [marker.species, ...marker.line]) expect(Dex.species.get(name).exists, name).toBe(true);
  }
  for (const triple of [pack.coreLiga.newTripleDefault]) {
    for (const type of triple) expect(Dex.types.get(type).exists, type).toBe(true);
  }
}

describe('format pack @pkmn ids', () => {
  it('example pack', () => {
    checkPack(examplePack);
  });

  it('example fixture: every stage name and species id resolves in @pkmn/dex', () => {
    for (const e of exampleFixture.entries) {
      const names = [e.base_pokemon, e.stage2_pokemon, e.stage3_pokemon].filter((n): n is string => n !== null);
      const ids = [e.species_ids.base, e.species_ids.stage2, e.species_ids.stage3].filter((n): n is string => n !== null);
      names.forEach((name, i) => {
        const species = Dex.species.get(name);
        expect(species.exists, name).toBe(true);
        expect(species.id, name).toBe(ids[i]);
      });
    }
  });

  it.skipIf(!HAS_PRIVATE)('private pack (companion overlay)', async () => {
    checkPack(await loadPrivatePack());
  });
});
