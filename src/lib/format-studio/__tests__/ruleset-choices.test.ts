import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesetOptions: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ resolveNamedRulesets: vi.fn() }));

import { listRulesetOptions } from '@/lib/supabase/queries/rulesets';
import { resolveNamedRulesets } from '@/lib/supabase/queries/ruleset-definitions';
import { loadRulesetChoices } from '../ruleset-choices';

const ACTOR = { playerId: 'p1', isAdmin: false };
const DEF = '00000000-0000-4000-8000-0000000000a1';
const HEAD = '00000000-0000-4000-8000-0000000000a2';
/** A legacy ruleset id: the id of version 1 of DEF. */
const LEGACY = '00000000-0000-4000-8000-0000000000a3';
const OTHER_DEF = '00000000-0000-4000-8000-0000000000b1';
const GONE = '00000000-0000-4000-8000-0000000000c1';

const naming = (...ids: string[]) => ({ stages: ids.map((id) => ({ ruleset: { kind: 'ruleset', id } })) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRulesetOptions).mockResolvedValue([
    { id: HEAD, definition_id: DEF, name: 'Spring OU', is_doubles: false, gen: 9, base_format: 'gen9ou', version_no: 3 },
    { id: 'h2', definition_id: OTHER_DEF, name: 'Doubles Cup', is_doubles: true, gen: 9, base_format: 'gen9doublesou', version_no: 1 },
  ]);
  vi.mocked(resolveNamedRulesets).mockResolvedValue(new Map());
});

describe('loadRulesetChoices', () => {
  it('lists every ruleset the actor may use by its definition id, with the head version number', async () => {
    const choices = await loadRulesetChoices(ACTOR, []);
    expect(choices).toEqual([
      { id: DEF, name: 'Spring OU', version_no: 3 },
      { id: OTHER_DEF, name: 'Doubles Cup', version_no: 1 },
    ]);
    expect(listRulesetOptions).toHaveBeenCalledWith(ACTOR);
  });

  it('resolves nothing when every named id is a definition id', async () => {
    await loadRulesetChoices(ACTOR, [naming(DEF), naming(OTHER_DEF, DEF)]);
    expect(resolveNamedRulesets).not.toHaveBeenCalled();
  });

  it('adds an alias for a legacy id: the label of its definition, marked with the definition id', async () => {
    vi.mocked(resolveNamedRulesets).mockResolvedValue(new Map([[LEGACY, { definition_id: DEF, head_version_id: HEAD }]]));
    const choices = await loadRulesetChoices(ACTOR, [naming(LEGACY), naming(DEF, LEGACY)]);
    expect(resolveNamedRulesets).toHaveBeenCalledTimes(1);
    expect(resolveNamedRulesets).toHaveBeenCalledWith([LEGACY]);
    expect(choices).toEqual([
      { id: DEF, name: 'Spring OU', version_no: 3 },
      { id: OTHER_DEF, name: 'Doubles Cup', version_no: 1 },
      { id: LEGACY, name: 'Spring OU', version_no: 3, definition_id: DEF },
    ]);
  });

  it('gives no entry to an id that resolves to nothing, or to a ruleset the actor may not use', async () => {
    const hidden = '00000000-0000-4000-8000-0000000000d1';
    vi.mocked(resolveNamedRulesets).mockResolvedValue(new Map([[LEGACY, { definition_id: hidden, head_version_id: 'x' }]]));
    const choices = await loadRulesetChoices(ACTOR, [naming(LEGACY, GONE)]);
    expect(choices.map((c) => c.id)).toEqual([DEF, OTHER_DEF]);
  });

  it('reads documents of any shape: a draft may be anything', async () => {
    await expect(loadRulesetChoices(ACTOR, [undefined, null, 'x', 7, {}, { stages: 'nope' }])).resolves.toHaveLength(2);
    expect(resolveNamedRulesets).not.toHaveBeenCalled();
  });
});
