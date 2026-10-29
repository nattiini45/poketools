import { describe, expect, it } from 'vitest';
import { MAX_BLOCKING_QUESTIONS, deriveClarifications, nextQuestions, type Clarification } from '../clarifications';
import { planReadiness } from '../readiness';
import { PLAYERS, okFacts, parseOrThrow, workedExample, workedExampleUnpublished } from './fixtures';

const ask = (plan: ReturnType<typeof workedExample>, uiLocale: 'en' | 'de' = 'de', facts = okFacts(plan)) =>
  deriveClarifications(plan, planReadiness(plan, facts), { uiLocale, facts });

describe('deriveClarifications (plan 4.9)', () => {
  it('asks nothing for a ready plan whose UI language matches the content language', () => {
    expect(ask(workedExample())).toEqual([]);
  });

  it('turns the first-turn blockers of the headline request into structured cards', () => {
    const base = workedExampleUnpublished();
    const plan = parseOrThrow({
      ...base,
      assumptions: [{ key: 'legs.regular_season', value: 2, source: 'admin', confirmed: true }],
      slots: {
        ...base.slots,
        roster: {
          entries: [
            { input: 'Ash', state: 'resolved', player_id: PLAYERS[0] },
            { input: 'Misty', state: 'candidates', player_ids: [PLAYERS[1], PLAYERS[2]] },
            { input: 'Brock', state: 'unresolved' },
          ],
          target_count: 12,
        },
      },
    });
    const questions = ask(plan);
    const byTopic = Object.fromEntries(questions.map((q) => [q.topic, q]));
    expect(byTopic.double_round_robin).toMatchObject({
      kind: 'choice',
      blocking: true,
      options: [{ id: 'single_round_robin', recommended: true }, { id: 'owner_schedules_engine_change' }],
    });
    expect(byTopic.roster_candidates).toMatchObject({
      kind: 'player_pick',
      path: '/slots/roster/entries/1',
      params: { input: 'Misty' },
      options: [{ id: PLAYERS[1] }, { id: PLAYERS[2] }],
    });
    // Never auto-create a guest, never auto-pick a fuzzy match: search again is the default, skip and a guest request are explicit.
    expect(byTopic.roster_unresolved.options.map((o) => o.id)).toEqual(['search_again', 'skip', 'ask_site_admin_for_guest']);
  });

  it('asks for names when there is no roster, for a number when the count is off, and a date when they are out of order', () => {
    const empty = parseOrThrow({ ...workedExample(), slots: { ...workedExample().slots, roster: undefined } });
    expect(ask(empty).map((q) => q.topic)).toEqual(['roster_names']);

    const short = parseOrThrow({
      ...workedExample(),
      slots: { ...workedExample().slots, roster: { ...workedExample().slots.roster!, target_count: 14 } },
    });
    expect(ask(short)).toEqual([expect.objectContaining({ topic: 'roster_count', kind: 'number', params: { target: 14, resolved: 12 } })]);

    const dates = parseOrThrow({
      ...workedExample(),
      slots: { ...workedExample().slots, league: { name: 'L', format_type: 'singles', language: 'de', start_date: '2026-11-02', end_date: '2026-10-01' } },
    });
    expect(ask(dates)).toEqual([expect.objectContaining({ topic: 'season_dates', kind: 'date', blocking: true })]);
  });

  it('asks about ban names and formes, one question per entry', () => {
    const plan = parseOrThrow({
      ...workedExampleUnpublished(),
      slots: {
        ...workedExampleUnpublished().slots,
        ruleset: { mode: 'new', name: 'N', base_locale: 'en', delta: { pokemon: { ban: ['rotom', 'kingambit'] }, moves: { ban: ['xyz'] } } },
      },
    });
    const facts = okFacts(plan, { dex: { 'pokemon:rotom': 'forme_expansion_needed', 'pokemon:kingambit': 'ok', 'moves:xyz': 'unknown' } });
    const questions = ask(plan, 'de', facts);
    expect(questions.find((q) => q.topic === 'ban_forme')).toMatchObject({ options: [{ id: 'all_formes' }, { id: 'this_forme_only', recommended: true }] });
    expect(questions.find((q) => q.topic === 'ban_unresolved')).toMatchObject({ kind: 'text', params: { category: 'moves', name: 'xyz' } });
  });

  it('offers the structure door with classic phases as the default', () => {
    const custom = parseOrThrow({ ...workedExample(), slots: { ...workedExample().slots, league: { name: 'L', format_type: 'custom', language: 'de' } } });
    expect(ask(custom)).toEqual([
      expect.objectContaining({ topic: 'structure_door', options: [{ id: 'classic_phases', recommended: true }, { id: 'custom_format' }] }),
    ]);
  });

  it('asks which ruleset when phases name the plan ruleset and there is none', () => {
    const plan = parseOrThrow({ ...workedExample(), slots: { ...workedExample().slots, ruleset: undefined } });
    expect(ask(plan)).toEqual([expect.objectContaining({ topic: 'ruleset_choice', options: [{ id: 'new_own_copy', recommended: true }, { id: 'use_existing' }, { id: 'fork_existing' }] })]);
  });

  it('asks the content language once, non-blocking, when it differs from the UI language', () => {
    const open = parseOrThrow({ ...workedExample(), assumptions: [] });
    expect(ask(open, 'en')).toEqual([
      expect.objectContaining({ topic: 'content_language', blocking: false, path: '/slots/league/language', options: [{ id: 'de', recommended: true }, { id: 'en' }] }),
    ]);
    expect(ask(open, 'de')).toEqual([]);
    // Answered (a confirmed assumption, as the worked example has) -> not asked again.
    expect(ask(workedExample(), 'en')).toEqual([]);
    const unconfirmed = parseOrThrow({ ...open, assumptions: [{ key: 'league.language', value: 'de', source: 'default', confirmed: false }] });
    expect(ask(unconfirmed, 'en').map((q) => q.topic)).toEqual(['content_language']);
  });

  it('asks the tour-bans toggle only for a preset that has tour extras', () => {
    const plan = parseOrThrow({
      ...workedExampleUnpublished(),
      assumptions: [],
      slots: { ...workedExampleUnpublished().slots, ruleset: { mode: 'new', name: 'N', base_locale: 'en', preset: 'gen9ou' } },
    });
    const plain = ask(plan, 'de');
    expect(plain.map((q) => q.topic)).not.toContain('tour_overlay');
    const withExtras = ask(plan, 'de', okFacts(plan, { rulesetPresets: { gen9ou: { known: true, hasTourOverlay: true } } }));
    expect(withExtras.find((q) => q.topic === 'tour_overlay')).toMatchObject({ blocking: false, options: [{ id: 'keep_preset_bans', recommended: true }, { id: 'add_tour_bans' }] });
    const decided = parseOrThrow({ ...plan, slots: { ...plan.slots, ruleset: { mode: 'new', name: 'N', base_locale: 'en', preset: 'gen9ou', tour_overlay: false } } });
    expect(ask(decided, 'de', okFacts(decided, { rulesetPresets: { gen9ou: { known: true, hasTourOverlay: true } } })).map((q) => q.topic)).not.toContain('tour_overlay');
  });

  it('gives each question a stable id and never repeats one', () => {
    const plan = parseOrThrow({ ...workedExample(), slots: { ...workedExample().slots, roster: { entries: [{ input: 'a', state: 'unresolved' }, { input: 'b', state: 'unresolved' }] } } });
    const first = ask(plan);
    const second = ask(plan);
    expect(first.map((q) => q.id)).toEqual(second.map((q) => q.id));
    expect(new Set(first.map((q) => q.id)).size).toBe(first.length);
  });
});

describe('nextQuestions: at most three blocking questions per turn', () => {
  const q = (id: string, blocking: boolean): Clarification => ({ id, kind: 'choice', topic: 'roster_unresolved', blocking, path: `/${id}`, params: {}, options: [] });

  it('takes the first three blocking questions and defers the rest', () => {
    const list = [q('a', true), q('b', false), q('c', true), q('d', true), q('e', true)];
    const batch = nextQuestions(list);
    expect(MAX_BLOCKING_QUESTIONS).toBe(3);
    expect(batch.ask.map((x) => x.id)).toEqual(['a', 'c', 'd']);
    expect(batch.later.map((x) => x.id)).toEqual(['b', 'e']);
  });

  it('never asks a non-blocking question by itself and honours a smaller budget', () => {
    expect(nextQuestions([q('a', false)]).ask).toEqual([]);
    expect(nextQuestions([q('a', true), q('b', true)], 1).ask.map((x) => x.id)).toEqual(['a']);
    expect(nextQuestions([q('a', true)], 0).ask).toEqual([]);
  });
});
