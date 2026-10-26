import { describe, expect, it } from 'vitest';
import { PRESETS, getPreset } from '../format-catalog';
import { FORMAT_DEFAULTS } from '../formats';
import { getBannedPokemonForTier } from '../tiers';
import { presetBanNames, resolvePresetRules, resolveTourOverlay } from '../preset-rules.server';
import { CHAMPIONS_ITEMS, CHAMPIONS_MOVES, CHAMPIONS_SPECIES_MEGA, CHAMPIONS_SPECIES_SELECTABLE } from '../preset-data/champions-roster.generated';
import { PRESET_RULES_VERSION } from '../preset-data/pin';

// Real-dex tests (no mocks), like dex.test.ts. The facts are the V3 corrections of the draft research
// (per-mod resolution) and the National Dex fixes, each checked against the pinned Showdown source.

function rules(id: string) {
  const found = resolvePresetRules(id);
  if (found === null) throw new Error(`no preset ${id}`);
  return found;
}

describe('resolvePresetRules', () => {
  it('answers null for an id the catalog does not know and for the blank template', () => {
    expect(resolvePresetRules('blank')).toBeNull();
    expect(resolvePresetRules('gen99xx')).toBeNull();
    expect(presetBanNames('gen99xx')).toBeNull();
  });

  it('is memoised and stamps the data version', () => {
    expect(resolvePresetRules('gen9ou')).toBe(resolvePresetRules('gen9ou'));
    expect(rules('gen9ou').catalog_version).toBe(PRESET_RULES_VERSION);
  });

  it('does not grow the memo with ids the catalog does not know (the id comes from public requests)', () => {
    for (let i = 0; i < 50; i++) expect(resolvePresetRules(`junk${i}`)).toBeNull();
    // A miss is never stored: asking again re-reads the catalog, and a known id is unaffected.
    expect(resolvePresetRules('junk0')).toBeNull();
    expect(resolvePresetRules('gen9ou')).toBe(resolvePresetRules('gen9ou'));
  });

  it('resolves every preset of the catalog, with sorted unique ids and clause ids', () => {
    for (const preset of PRESETS) {
      const resolved = rules(preset.id);
      expect(resolved.id).toBe(preset.id);
      expect(resolved.gen).toBe(preset.gen);
      expect(resolved.doubles).toBe(preset.gameType === 'doubles');
      expect(resolved.clauses, preset.id).toEqual(preset.clauses.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
      for (const category of ['pokemon', 'moves', 'items', 'abilities'] as const) {
        const { ids } = resolved[category];
        expect(ids, `${preset.id} ${category}`).toEqual([...new Set(ids)].sort());
        expect(ids.every((id) => /^[a-z0-9]+$/.test(id)), `${preset.id} ${category} ids`).toBe(true);
      }
    }
  });
});

describe('the ladder Little Cup and NFE presets are allowlists', () => {
  it('Little Cup allows the first stages the dex tiers as LC, less the generation bans, in every generation', () => {
    for (const id of ['gen4lc', 'gen8lc', 'gen9lc']) {
      const lc = rules(id);
      expect(lc.pokemon.mode, id).toBe('allow');
      expect(lc.pokemon.ids, id).toEqual(expect.arrayContaining(['pichu', 'dratini', 'riolu']));
      for (const out of ['pikachu', 'dragonite', 'garchomp', 'scyther', 'gligar']) expect(lc.pokemon.ids, `${id} ${out}`).not.toContain(out);
      expect(lc.facts).toMatchObject({ littleCup: true, maxLevel: 5 });
    }
    const gen9 = rules('gen9lc');
    for (const banned of ['diglett', 'dunsparce', 'aipom', 'yanma']) expect(gen9.pokemon.ids).not.toContain(banned);
    expect(gen9.moves.ids).toEqual(['batonpass', 'stickyweb']);
  });

  it('NFE allows every species that can still evolve', () => {
    const nfe = rules('gen9nfe');
    expect(nfe.pokemon.mode).toBe('allow');
    expect(nfe.pokemon.ids).toEqual(expect.arrayContaining(['haunter', 'dratini', 'dragonair', 'pichu']));
    for (const out of ['garchomp', 'gengar', 'dragonite']) expect(nfe.pokemon.ids).not.toContain(out);
  });
});

describe('draft presets are resolved per mod', () => {
  it('the gen 3 mod bans the whole Uber tier (15 species), Swagger, Assist and three items, and has no team preview', () => {
    const gen3 = rules('gen3draft');
    expect(gen3.pokemon).toEqual({
      mode: 'block',
      ids: [
        'deoxys', 'deoxysattack', 'deoxysdefense', 'deoxysspeed', 'groudon', 'hooh', 'kyogre', 'latias', 'latios', 'lugia',
        'mew', 'mewtwo', 'rayquaza', 'wobbuffet', 'wynaut',
      ],
    });
    expect(gen3.moves.ids).toEqual(['assist', 'swagger']);
    expect(gen3.items.ids).toEqual(['focusband', 'kingsrock', 'quickclaw']);
    expect(gen3.clauses).toEqual(expect.arrayContaining(['oneboostpasserclause', 'freezeclausemod', 'accuracymovesclause', 'batonpasstrapclause']));
    expect(gen3.facts.teamPreview).toBe(false);
    expect(gen3.combination_bans).toEqual(['Smeargle + Ingrain', 'Baton Pass + Ancient Power', 'Baton Pass + Silver Wind']);
    // The same Standard Draft in gen 4 and later has no species banlist: the mod decides.
    expect(rules('gen4draft').pokemon).toEqual({ mode: 'block', ids: [] });
    expect(rules('gen9draft').pokemon).toEqual({ mode: 'block', ids: [] });
  });

  it('gen 4 and 5 bans match the source, and gen 4 repeals the evasion abilities clause', () => {
    const gen4 = rules('gen4draft');
    expect(gen4.moves.ids).toEqual(['assist', 'swagger']);
    expect(gen4.items.ids).toEqual(['kingsrock', 'quickclaw']);
    expect(gen4.clauses).toEqual(expect.arrayContaining(['evasionitemsclause', 'evasionmovesclause', 'drypassclause', 'accuracymovesclause']));
    expect(gen4.clauses).not.toContain('evasionclause');
    expect(gen4.facts.teamPreview).toBe(false);
    const gen5 = rules('gen5draft');
    expect(gen5.abilities.ids).toEqual(['moody']);
    expect(gen5.items.ids).toEqual(['kingsrock', 'quickclaw', 'souldew']);
    expect(gen5.clauses).toEqual(expect.arrayContaining(['drypassclause', 'gemsclause', 'sleepmovesclause']));
    expect(gen5.combination_bans).toHaveLength(5);
  });

  it('gen 6 bans Moody, Soul Dew and Swagger; gen 7 and 8 ban nothing besides their clauses', () => {
    const gen6 = rules('gen6draft');
    expect([gen6.abilities.ids, gen6.items.ids, gen6.moves.ids]).toEqual([['moody'], ['souldew'], ['swagger']]);
    for (const id of ['gen7draft', 'gen8draft', 'gen9draft']) {
      const resolved = rules(id);
      expect([resolved.pokemon.ids, resolved.moves.ids, resolved.items.ids, resolved.abilities.ids], id).toEqual([[], [], [], []]);
    }
    expect(rules('gen8draft').clauses).toContain('dynamaxclause');
    expect(rules('gen9draft').clauses).not.toContain('dynamaxclause');
  });

  it('is Showdown-faithful: no Species Clause outside the Champions mod, no Tera ban, no Moody ban', () => {
    for (const id of ['gen9draft', 'gen9natdexdraft', 'gen8natdexdraft', 'gen9natdexlcdraft', 'gen9doublesdraft', 'gen9doubles4draft']) {
      expect(rules(id).clauses, id).not.toContain('speciesclause');
      expect(rules(id).clauses, id).not.toContain('terastalclause');
    }
    expect(rules('gen9natdexdraft').abilities.ids).toEqual([]);
    expect(rules('gen9natdexdraft').items.ids).toEqual([]);
  });

  it('NatDex Draft lists the whole National Dex universe (past species legal) and bans nothing', () => {
    const natdex = rules('gen9natdexdraft');
    expect(natdex.universe).toBe('national');
    expect(natdex.pokemon).toEqual({ mode: 'block', ids: [] });
    expect(natdex.facts.minSourceGen).toBe(1);
  });

  it('NatDex LC Draft bans Dragon Rage and Sonic Boom, allows only first stages with an evolution and has Item Clause 2', () => {
    const lc = rules('gen9natdexlcdraft');
    expect(lc.moves.ids).toEqual(['dragonrage', 'sonicboom']);
    expect(lc.pokemon.mode).toBe('allow');
    expect(lc.pokemon.ids).toEqual(expect.arrayContaining(['pichu', 'dratini', 'gastly', 'riolu', 'scyther']));
    expect(lc.pokemon.ids).not.toContain('pikachu');
    expect(lc.pokemon.ids).not.toContain('dragonite');
    expect(lc.pokemon.ids).not.toContain('ditto');
    expect(lc.clauses).toContain('itemclause');
    expect(lc.facts).toMatchObject({ itemClauseLimit: 2, littleCup: true, maxLevel: 5 });
  });

  it('the doubles drafts drop the clauses the source repeals', () => {
    expect(rules('gen9doublesdraft').clauses).toEqual(['nicknameclause', 'ohkoclause', 'endlessbattleclause']);
    expect(rules('gen9doubles4draft').clauses).toEqual(['nicknameclause', 'itemclause', 'endlessbattleclause']);
    expect(rules('gen9doubles4draft').facts).toMatchObject({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1 });
    // Only the Evasion Moves clause is repealed in the Gen 8 4v4 format; no Dynamax clause as written in the source.
    const gen8 = rules('gen8natdexdoubles4draft');
    expect(gen8.clauses).toEqual(['nicknameclause', 'itemclause', 'evasionabilitiesclause', 'evasionitemsclause', 'endlessbattleclause']);
  });
});

describe('the Champions presets', () => {
  it('Draft and 4v4 Doubles Draft allow exactly the roster: species, items, abilities and moves', () => {
    for (const id of ['gen9championsdraft', 'gen9champions4doublesdraft']) {
      const champions = rules(id);
      expect(champions.mod).toBe('champions');
      expect(champions.pokemon.mode).toBe('allow');
      expect(champions.items.mode).toBe('allow');
      expect(champions.abilities.mode).toBe('allow');
      expect(champions.moves.mode).toBe('allow');
      expect(champions.pokemon.ids).toHaveLength(382);
      expect(champions.items.ids).toHaveLength(CHAMPIONS_ITEMS.length);
      expect(champions.moves.ids).toHaveLength(CHAMPIONS_MOVES.length);
      expect(champions.abilities.ids).toHaveLength(216);
    }
    const draft = rules('gen9championsdraft');
    expect(draft.pokemon.ids).toEqual(expect.arrayContaining(['charizard', 'charizardmegax', 'garchomp', 'greninja']));
    expect(draft.pokemon.ids).not.toContain('mewtwo');
    expect(draft.pokemon.ids).not.toContain('koraidon');
    expect(draft.items.ids).toEqual(expect.arrayContaining(['charizarditex', 'leftovers', 'focusband', 'kingsrock', 'quickclaw']));
    // Not legal in Champions.
    expect(draft.items.ids).not.toContain('razorfang');
    expect(draft.items.ids).not.toContain('choiceband');
    expect(draft.moves.ids).toEqual(expect.arrayContaining(['batonpass', 'swagger', 'lastrespects', 'shedtail']));
    expect(draft.moves.ids).not.toContain('terablast');
    expect(draft.moves.ids).not.toContain('hiddenpower');
    expect(draft.abilities.ids).toEqual(expect.arrayContaining(['moody', 'shadowtag', 'parentalbond']));
    expect(draft.abilities.ids).not.toContain('arenatrap');
    expect(draft.abilities.ids).not.toContain('wonderguard');
  });

  it('applies the champions mod rules, not the base Standard Draft', () => {
    const draft = rules('gen9championsdraft');
    // Species Clause comes from the mod's Standard AG; the Item Clause is repealed.
    expect(draft.clauses).toContain('speciesclause');
    expect(draft.clauses).not.toContain('itemclause');
    expect(draft.facts).toMatchObject({ level: 50, minTeamSize: 6, itemClauseLimit: null });
    expect(draft.facts.unmodelled).toContain('champions_move_legality');
    // 4v4 is the champions Flat Rules: Item Clause 1, no Greninja-Bond ban, no Endless Battle Clause.
    const doubles = rules('gen9champions4doublesdraft');
    expect(doubles.doubles).toBe(true);
    expect(doubles.clauses).toEqual(['speciesclause', 'nicknameclause', 'itemclause']);
    expect(doubles.facts).toMatchObject({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1 });
  });

  it('keeps the roster ids consistent with the generated data', () => {
    const draft = rules('gen9championsdraft');
    for (const id of [...CHAMPIONS_SPECIES_SELECTABLE, ...CHAMPIONS_SPECIES_MEGA]) expect(draft.pokemon.ids).toContain(id);
  });

  it('NatDex Draft has no roster list (only its species side is known) and says so', () => {
    const natdex = rules('gen9championsnatdexdraft');
    expect(natdex.pokemon).toEqual({ mode: 'block', ids: [] });
    expect(natdex.items.mode).toBe('block');
    expect(natdex.facts.unmodelled).toEqual(expect.arrayContaining(['champions_natdex_roster']));
    expect(natdex.universe).toBe('national');
  });
});

describe('the National Dex family reads the whole National Dex', () => {
  it('gen 9 National Dex bans the Uber and AG species including the 29 past ones the Generations wrapper hides', () => {
    const natdex = rules('gen9nationaldex');
    const standard = getBannedPokemonForTier('OU', 9, 'natDexTier');
    expect(natdex.pokemon.mode).toBe('block');
    // 102 Uber + AG species in the raw data, 73 visible through Generations: the difference is the 29 Past species.
    expect(natdex.pokemon.ids).toHaveLength(102);
    expect(standard).toHaveLength(73);
    for (const hidden of ['mewtwomegax', 'mewtwomegay', 'groudonprimal', 'kyogreprimal', 'rayquazamega', 'genesect', 'xerneas', 'yveltal', 'zygarde', 'pheromosa', 'marshadow', 'naganadel', 'dracovish', 'lucariomega']) {
      expect(natdex.pokemon.ids, hidden).toContain(hidden);
    }
    expect(natdex.pokemon.ids).toContain('koraidon');
  });

  it('gen 9 National Dex bans the verified moves, items and abilities', () => {
    const natdex = rules('gen9nationaldex');
    expect(natdex.moves.ids).toEqual(['assist', 'batonpass', 'lastrespects', 'shedtail']);
    expect(natdex.items.ids).toEqual(['kingsrock', 'quickclaw', 'razorfang']);
    expect(natdex.abilities.ids).toEqual(['arenatrap', 'moody', 'powerconstruct', 'shadowtag']);
    expect(natdex.clauses).toEqual(expect.arrayContaining(['terastalclause', 'speciesclause', 'sleepclausemod']));
  });

  it('gen 8 National Dex has no Assist, Last Respects or Shed Tail (they do not exist in gen 8) and a Dynamax clause', () => {
    const natdex = rules('gen8nationaldex');
    expect(natdex.moves.ids).toEqual(['batonpass']);
    expect(natdex.clauses).toContain('dynamaxclause');
    expect(natdex.clauses).not.toContain('terastalclause');
  });

  it('Ubers, UU and RU add up the way the source lists them', () => {
    const ubers = rules('gen9nationaldexubers');
    // The ND AG tier has 6 species in the data (two of them past species the Generations wrapper hides) + Shedinja.
    expect(ubers.pokemon.ids).toEqual(['calyrexshadow', 'gengarmega', 'koraidon', 'miraidon', 'rayquazamega', 'shedinja', 'xerneas']);
    expect(ubers.moves.ids).toEqual(['assist', 'batonpass']);
    expect(ubers.clauses).toContain('megarayquazaclause');
    expect(ubers.clauses).not.toContain('evasionclause');
    const uu = rules('gen9nationaldexuu');
    const ru = rules('gen9nationaldexru');
    expect(uu.abilities.ids).toEqual(expect.arrayContaining(['drizzle', 'drought', 'arenatrap']));
    expect(uu.items.ids).toContain('lightclay');
    expect(ru.items.ids).toContain('slowbronite');
    expect(uu.items.ids).not.toContain('slowbronite');
    expect(ru.pokemon.ids.length).toBeGreaterThan(uu.pokemon.ids.length);
    expect(uu.pokemon.ids.length).toBeGreaterThan(rules('gen9nationaldex').pokemon.ids.length);
    expect(rules('gen9nationaldexag')).toMatchObject({ pokemon: { ids: [] }, moves: { ids: [] } });
    const gen8Ubers = rules('gen8nationaldexubers');
    expect(gen8Ubers.items.ids).toEqual(['ultranecroziumz']);
    expect(gen8Ubers.abilities.ids).toEqual(['moody', 'shadowtag']);
  });

  it('the doubles Ubers formats ban nothing or Shedinja and Assist', () => {
    expect(rules('gen9doublesubers')).toMatchObject({ pokemon: { ids: [] }, doubles: true });
    expect(rules('gen9nationaldexdoublesubers')).toMatchObject({ pokemon: { ids: ['shedinja'] }, moves: { ids: ['assist'] } });
  });

  it('Doubles LC allows the Little Cup species less the 15 banned ones', () => {
    const lc = rules('gen9doubleslc');
    expect(lc.pokemon.mode).toBe('allow');
    expect(lc.pokemon.ids).toEqual(expect.arrayContaining(['gastly', 'pawniard', 'dratini']));
    for (const banned of ['scyther', 'dunsparce', 'murkrow', 'sneasel', 'vulpix', 'yanma', 'gligar']) expect(lc.pokemon.ids).not.toContain(banned);
    expect(lc.pokemon.ids).not.toContain('dragonite');
  });
});

describe('presetBanNames and FORMAT_DEFAULTS (the legacy flat shape)', () => {
  it('is the explicit block list of the resolved rules, as display names', () => {
    expect(presetBanNames('gen9ou')?.moves).toEqual(['Baton Pass', 'Last Respects', 'Shed Tail']);
    expect(FORMAT_DEFAULTS['gen9ou'].banned_abilities).toEqual([]);
    expect(FORMAT_DEFAULTS['gen6draft'].banned_abilities).toEqual(['Moody']);
    expect(FORMAT_DEFAULTS['gen9nationaldex'].banned_abilities).toEqual(['Arena Trap', 'Moody', 'Power Construct', 'Shadow Tag']);
  });

  it('shows only the explicit bans of a roster or Little Cup preset (a flat list cannot hold an allowlist)', () => {
    expect(FORMAT_DEFAULTS['gen9championsdraft'].banned_pokemon).toEqual([]);
    expect(FORMAT_DEFAULTS['gen9natdexlcdraft'].banned_moves).toEqual(['Dragon Rage', 'Sonic Boom']);
    expect(FORMAT_DEFAULTS['gen9natdexlcdraft'].banned_pokemon).toEqual([]);
  });

  it('has one entry per preset plus blank, with the preset clauses', () => {
    expect(Object.keys(FORMAT_DEFAULTS).sort()).toEqual([...PRESETS.map((preset) => preset.id), 'blank'].sort());
    for (const preset of PRESETS) expect(FORMAT_DEFAULTS[preset.id].clauses).toEqual(preset.clauses);
  });
});

describe('resolveTourOverlay', () => {
  it('is null for a preset without documented Smogon extras and for an unknown id', () => {
    expect(resolveTourOverlay('gen9draft')).toBeNull();
    expect(resolveTourOverlay('gen9ou')).toBeNull();
    expect(resolveTourOverlay('gen99xx')).toBeNull();
  });

  it('exists exactly for the presets the catalog flags', () => {
    for (const preset of PRESETS) expect(resolveTourOverlay(preset.id) !== null, preset.id).toBe(preset.tourOverlay);
    expect(PRESETS.filter((preset) => preset.tourOverlay).map((preset) => preset.id)).toEqual(['gen9natdexdraft', 'gen9natdexlcdraft', 'gen9doublesdraft']);
  });

  it('NatDex: the SV NatDex tour extras, with the Z-crystals and the gems expanded from the dex', () => {
    const overlay = resolveTourOverlay('gen9natdexdraft');
    expect(overlay).not.toBeNull();
    if (overlay === null) return;
    expect(overlay.clausesAdd).toEqual(['speciesclause', 'batonpassclause', 'terastalclause']);
    expect(overlay.clausesRemove).toEqual([]);
    expect(overlay.moves).toEqual(['hiddenpower', 'lastrespects', 'shedtail']);
    expect(overlay.abilities).toEqual(['moody', 'powerconstruct']);
    expect(overlay.items).toEqual(expect.arrayContaining(['berserkgene', 'kingsrock', 'quickclaw', 'razorfang', 'normaliumz', 'firegem', 'aloraichiumz']));
    expect(overlay.items).not.toContain('normalgem');
    expect(overlay.sources.every((url) => url.startsWith('https://www.smogon.com/forums/threads/'))).toBe(true);
    expect(overlay.catalog_version).toBe(PRESET_RULES_VERSION);
    // The extras are not part of the preset itself.
    const preset = rules('gen9natdexdraft');
    expect(preset.moves.ids).not.toContain('hiddenpower');
    expect(preset.clauses).not.toContain('terastalclause');
  });

  it('NatDex LC drops the Item Clause; the doubles draft adds the tour code bans', () => {
    const lc = resolveTourOverlay('gen9natdexlcdraft');
    expect(lc?.clausesRemove).toEqual(['itemclause']);
    expect(lc?.moves).toEqual(['batonpass', 'grassyglide', 'hiddenpower']);
    // "Razor Claw" on the thread is left to the admin (unresolved), neither it nor Razor Fang is applied.
    expect(lc?.items).not.toContain('razorfang');
    expect(lc?.items).not.toContain('razorclaw');
    expect(lc?.unresolved.join(' ')).toContain('Razor Claw');
    const doubles = resolveTourOverlay('gen9doublesdraft');
    expect(doubles?.clausesAdd).toEqual(['speciesclause', 'gravitysleepclause', 'teratypepreview']);
    expect(doubles?.moves).toEqual(['darkvoid', 'doubleteam', 'lastrespects', 'minimize']);
  });

  it('only names clauses that the clause catalog knows and that belong to the preset when removed', () => {
    for (const preset of PRESETS.filter((entry) => entry.tourOverlay)) {
      const overlay = resolveTourOverlay(preset.id);
      expect(overlay, preset.id).not.toBeNull();
      const own = new Set(getPreset(preset.id)?.clauses.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
      for (const removed of overlay?.clausesRemove ?? []) expect(own.has(removed), `${preset.id} removes ${removed}`).toBe(true);
      for (const added of overlay?.clausesAdd ?? []) expect(own.has(added), `${preset.id} adds ${added} that it already has`).toBe(false);
    }
  });
});
