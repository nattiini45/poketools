import { describe, expect, it } from 'vitest';
import { idsToNames, namesToIds } from '../../editor/names-adapter';

const CATALOG: Record<string, string> = { fakeout: 'Fake Out', choicescarf: 'Choice Scarf', farfetchd: "Farfetch'd" };
const nameOf = (id: string) => CATALOG[id];

describe('namesToIds', () => {
  it('folds the stored English names to ids, in order', () => {
    expect(namesToIds(['Fake Out', 'Choice Scarf', "Farfetch'd"])).toEqual(['fakeout', 'choicescarf', 'farfetchd']);
  });

  it('keeps a name the catalog does not know (it shows as an unknown entry), shows two spellings of one id once, drops nothing else', () => {
    expect(namesToIds(['Fake-Out', 'Fake Out', 'Totally Made Up', '', '  '])).toEqual(['fakeout', 'totallymadeup']);
  });

  it('folds accents and gender signs the way the app does', () => {
    expect(namesToIds(['Flabébé', 'Nidoran♀'])).toEqual(['flabebe', 'nidoranf']);
  });
});

describe('idsToNames', () => {
  it('keeps the exact spelling of a stored name, whatever the id fold would give', () => {
    expect(idsToNames(['fakeout', 'choicescarf'], ['Fake-Out', 'Choice Scarf'], nameOf)).toEqual(['Fake-Out', 'Choice Scarf']);
  });

  it('writes a newly added entry as the catalog English name', () => {
    expect(idsToNames(['fakeout', 'farfetchd'], ['Fake Out'], nameOf)).toEqual(['Fake Out', "Farfetch'd"]);
  });

  it('keeps an unknown stored name through a round trip, and the id of an entry the catalog cannot name', () => {
    const stored = ['Totally Made Up', 'Fake Out'];
    expect(idsToNames(namesToIds(stored), stored, nameOf)).toEqual(stored);
    expect(idsToNames(['mystery'], [], nameOf)).toEqual(['mystery']);
  });

  it('removing an entry removes exactly that name', () => {
    expect(idsToNames(['choicescarf'], ['Fake Out', 'Choice Scarf'], nameOf)).toEqual(['Choice Scarf']);
  });
});
