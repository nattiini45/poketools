/**
 * RoundManager's start-up guardrails: the checklist above Generate (and the buttons it disables), the pending
 * round banner, the default-off "start right away" option, and the round-robin "all rounds generated" state.
 * Rendered through react-dom/server (vitest 'node' env, no DOM, so effects do not run): the participant
 * summary comes in through `initialParticipants`.
 */
import { describe, expect, it, vi } from 'vitest';
import RoundManager, { generateRequestInit } from '../RoundManager';
import { fetchParticipantsSummary } from '../useParticipantsSummary';
import { renderWithI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'r-1',
    tournament_id: 't-1',
    name: 'Round 1',
    round_number: 1,
    best_of: 3,
    status: 'completed',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function roundN(n: number, status: Round['status'] = 'completed'): Round {
  return makeRound({ id: `r-${n}`, name: `Round ${n}`, round_number: n, status });
}

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 't-1',
    name: 'Weekly',
    bracket_type: 'swiss',
    best_of_default: 3,
    ruleset_id: 'rs-1',
    status: 'active',
    bracket_reset_enabled: true,
    ...overrides,
  } as unknown as Tournament;
}

function summary(count: number, seededCount = count) {
  return {
    count,
    seededCount,
    playerIds: Array.from({ length: count }, (_, i) => `p${i + 1}`),
  };
}

/** The opening tag of the button whose text contains `label`; `null` when no such button is rendered. */
function buttonTag(html: string, label: string): string | null {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]).includes(label)) return match[1];
  }
  return null;
}

const isDisabled = (tag: string | null) => tag !== null && /\sdisabled(=|\s|$)/.test(` ${tag}`);

function render(props: {
  tournament?: Tournament;
  rounds?: Round[];
  participants?: ReturnType<typeof summary> | null;
  locale?: 'en' | 'de';
  groupsInUse?: boolean;
}) {
  return renderWithI18n(
    <RoundManager
      tournament={props.tournament ?? makeTournament()}
      initialRounds={props.rounds ?? []}
      rulesetName="Standard OU"
      initialParticipants={props.participants ?? null}
      groupsInUse={props.groupsInUse}
      checklistLinks={{ participants: '#tournament-participants' }}
    />,
    { locale: props.locale ?? 'en' },
  );
}

describe('RoundManager start-up checklist', () => {
  it('too few participants: shows the reason and disables Generate Next', () => {
    const html = render({ participants: summary(0) });
    const text = textOf(html);
    expect(text).toContain('0 participants enrolled. Add at least 2 participants.');
    expect(text).toContain('Generating is disabled until the open items are done.');
    expect(html).toContain('href="#tournament-participants"');
    const tag = buttonTag(html, 'Generate Next Round');
    expect(isDisabled(tag)).toBe(true);
    // The disabled button points at the checklist region that explains it.
    expect(tag).toContain('aria-describedby="startup-checklist-t-1"');
    expect(html).toContain('id="startup-checklist-t-1"');
  });

  it('enough participants: Generate Next is enabled and the checklist reports them', () => {
    const html = render({ participants: summary(8) });
    expect(textOf(html)).toContain('8 participants enrolled (minimum 2)');
    expect(textOf(html)).not.toContain('Generating is disabled');
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(false);
  });

  it('a roster that is still loading never blocks Generate', () => {
    const html = render({ participants: null });
    expect(textOf(html)).toContain('Checking participants');
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(false);
  });

  it('manual round creation is not gated by the checklist', () => {
    const html = render({ participants: summary(0) });
    expect(isDisabled(buttonTag(html, 'Create Manual Round'))).toBe(false);
  });

  it('Swiss with the last round still active: names the round and disables Generate', () => {
    const html = render({ rounds: [roundN(1), roundN(2, 'active')], participants: summary(8) });
    expect(textOf(html)).toContain('Round 2 is not completed yet. Complete it before generating the next round.');
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(true);
  });

  it('Swiss with the last round completed: Generate Next is enabled', () => {
    const html = render({ rounds: [roundN(1), roundN(2)], participants: summary(8) });
    expect(textOf(html)).toContain('Previous round completed');
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(false);
  });

  it('an elimination bracket that is already built has no checklist and no Generate', () => {
    const html = render({
      tournament: makeTournament({ bracket_type: 'single_elim' }),
      rounds: [makeRound({ bracket_side: 'winners', status: 'active' })],
      participants: summary(8),
    });
    expect(html).not.toContain('role="region"');
    expect(buttonTag(html, 'Generate Next Round')).toBeNull();
    expect(html).not.toContain('Start the new round right away');
  });

  it('a completed tournament shows no checklist', () => {
    const html = render({
      tournament: makeTournament({ status: 'completed' }),
      rounds: [roundN(1)],
      participants: summary(8),
    });
    expect(html).not.toContain('role="region"');
  });

  it('speaks German', () => {
    const html = render({ participants: summary(1), locale: 'de' });
    expect(textOf(html)).toContain('Erst 1 Teilnehmer eingetragen. Trage mindestens 2 Teilnehmer ein.');
    expect(textOf(html)).toContain('Neue Runde sofort starten');
  });
});

describe('RoundManager round robin completion', () => {
  const roundRobin = makeTournament({ bracket_type: 'round_robin' });

  it('4 participants and rounds 1..3: both Generate buttons are gone and the line says all 3 exist', () => {
    const html = render({ tournament: roundRobin, rounds: [roundN(1), roundN(2), roundN(3)], participants: summary(4) });
    expect(buttonTag(html, 'Generate Next Round')).toBeNull();
    expect(buttonTag(html, 'Generate All Rounds')).toBeNull();
    expect(textOf(html)).toContain('All 3 rounds generated');
    // The line replaces the blocked checklist row, so the sentence appears once and nothing is "blocked".
    expect(textOf(html).match(/All 3 rounds generated/g)).toHaveLength(1);
    expect(textOf(html)).not.toContain('Generating is disabled');
    expect(html).not.toContain('Start the new round right away');
  });

  it('a round-robin field with an odd count has as many rounds as players', () => {
    const html = render({
      tournament: roundRobin,
      rounds: [roundN(1), roundN(2), roundN(3)],
      participants: summary(3),
    });
    expect(textOf(html)).toContain('All 3 rounds generated');
  });

  it('4 participants and rounds 1..2: both buttons are enabled', () => {
    const html = render({ tournament: roundRobin, rounds: [roundN(1), roundN(2)], participants: summary(4) });
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(false);
    expect(isDisabled(buttonTag(html, 'Generate All Rounds'))).toBe(false);
    expect(textOf(html)).toContain('2 of 3 rounds generated');
    expect(textOf(html)).not.toContain('All 3 rounds generated');
  });

  it('a gap before the last round: Generate Next is disabled, Generate All fills the gap', () => {
    const html = render({
      tournament: roundRobin,
      rounds: [roundN(1), roundN(2), roundN(4), roundN(5)],
      participants: summary(6),
    });
    expect(textOf(html)).toContain('Round 3 is missing. Generate All Rounds fills the gap.');
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(true);
    expect(isDisabled(buttonTag(html, 'Generate All Rounds'))).toBe(false);
  });

  it('a grouped phase does not count rounds on the client: Generate stays available', () => {
    const html = render({
      tournament: roundRobin,
      rounds: [roundN(1), roundN(2), roundN(3)],
      participants: summary(4),
      groupsInUse: true,
    });
    expect(isDisabled(buttonTag(html, 'Generate Next Round'))).toBe(false);
    expect(textOf(html)).not.toContain('All 3 rounds generated');
  });

  it('shows the all-generated line in German', () => {
    const html = render({
      tournament: roundRobin,
      rounds: [roundN(1), roundN(2), roundN(3)],
      participants: summary(4),
      locale: 'de',
    });
    expect(textOf(html)).toContain('Alle 3 Runden wurden erstellt');
  });
});

describe('RoundManager pending round banner', () => {
  it('a single pending round: a notice with a one-click Start', () => {
    const html = render({ rounds: [roundN(1, 'pending')], participants: summary(8) });
    const text = textOf(html);
    expect(text).toContain('Round 1 has not been started');
    expect(text).toContain('Players can report once you start this round.');
    expect(buttonTag(html, 'Start Round 1')).not.toBeNull();
    expect(isDisabled(buttonTag(html, 'Start Round 1'))).toBe(false);
  });

  it('round 1 completed and round 2 pending: the banner names round 2', () => {
    const html = render({ rounds: [roundN(1), roundN(2, 'pending')], participants: summary(8) });
    expect(textOf(html)).toContain('Round 2 has not been started');
  });

  it('round 1 active with round 2 pending: no banner (round 2 is not startable yet)', () => {
    const html = render({ rounds: [roundN(1, 'active'), roundN(2, 'pending')], participants: summary(8) });
    expect(textOf(html)).not.toContain('has not been started');
    expect(buttonTag(html, 'Start Round')).toBeNull();
  });

  it('a completed tournament shows no banner', () => {
    const html = render({
      tournament: makeTournament({ status: 'completed' }),
      rounds: [roundN(1, 'pending')],
      participants: summary(8),
    });
    expect(textOf(html)).not.toContain('has not been started');
  });

  it('speaks German', () => {
    const html = render({ rounds: [roundN(1, 'pending')], participants: summary(8), locale: 'de' });
    expect(textOf(html)).toContain('Runde 1 wurde noch nicht gestartet');
    expect(textOf(html)).toContain('Runde 1 starten');
  });
});

describe('RoundManager start-now option', () => {
  it('is rendered unchecked, with its hint', () => {
    const html = render({ participants: summary(8) });
    const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '';
    expect(checkbox).not.toBe('');
    expect(checkbox).not.toMatch(/\schecked/);
    const text = textOf(html);
    expect(text).toContain('Start the new round right away');
    expect(text).toContain('Players can report results as soon as a round is started.');
    // Only round robin has Generate All Rounds, so only it needs the extra sentence.
    expect(text).not.toContain('only the first new round is started');
  });

  it('round robin adds the Generate All hint', () => {
    const html = render({
      tournament: makeTournament({ bracket_type: 'round_robin' }),
      participants: summary(8),
    });
    expect(textOf(html)).toContain('With Generate All Rounds, only the first new round is started.');
  });

  it('is offered next to Generate Bracket for an elimination bracket that is not built yet', () => {
    const html = render({ tournament: makeTournament({ bracket_type: 'single_elim' }), participants: summary(8) });
    expect(buttonTag(html, 'Generate Bracket')).not.toBeNull();
    expect(textOf(html)).toContain('Start the new round right away');
  });
});

describe('generateRequestInit', () => {
  it('is undefined when unchecked, so the request stays a plain POST', () => {
    expect(generateRequestInit(false)).toBeUndefined();
  });

  it('carries the start_round body and the JSON header when checked', () => {
    expect(generateRequestInit(true)).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_round: true }),
    });
  });
});

describe('fetchParticipantsSummary', () => {
  const jsonFetch = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('maps the participants endpoint to a count, a seeded count and the ids', async () => {
    const fetchImpl = jsonFetch({
      success: true,
      data: [
        { id: 'p1', name: 'Alice', seed: 1 },
        { id: 'p2', name: 'Bob', seed: null },
        { id: 'p3', name: 'Cara', seed: 3 },
      ],
    });

    expect(await fetchParticipantsSummary('t-1', fetchImpl)).toEqual({
      count: 3,
      seededCount: 2,
      playerIds: ['p1', 'p2', 'p3'],
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/tournaments/t-1/participants');
  });

  it('an empty roster is a summary of zero, not a failure', async () => {
    expect(await fetchParticipantsSummary('t-1', jsonFetch({ success: true, data: [] }))).toEqual({
      count: 0,
      seededCount: 0,
      playerIds: [],
    });
  });

  it('returns null for an API failure or an offline request', async () => {
    expect(await fetchParticipantsSummary('t-1', jsonFetch({ success: false, error: 'no' }))).toBeNull();
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await fetchParticipantsSummary('t-1', offline)).toBeNull();
  });
});

describe('RoundManager round rows', () => {
  it('lets the row and its action buttons wrap, so Delete is not clipped on a narrow screen', () => {
    const html = render({ rounds: [roundN(1, 'pending')], participants: summary(8) });
    expect(html).toMatch(/class="p-3 flex flex-wrap items-center justify-between gap-2"/);
    expect(html).toMatch(/<div class="flex flex-wrap items-center gap-2"><select/);
  });
});

describe('RoundManager round-robin progress', () => {
  it('shows no "0 of 0 rounds generated" row while nobody is enrolled', () => {
    const html = render({
      tournament: makeTournament({ bracket_type: 'round_robin' }),
      rounds: [roundN(1, 'pending')],
      participants: summary(0),
    });
    expect(textOf(html)).not.toContain('0 of 0');
  });
});
