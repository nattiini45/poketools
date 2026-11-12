/** @vitest-environment jsdom */
/**
 * The new-competition wizard (/admin/leagues/new): starting point, details, review. Covers the step gates, the
 * "what gets created" rail, the request body of each of the four starts, where the admin lands, a failed create,
 * the double-submit guard and both UI languages. The pure helpers are tested in lib/league-admin/__tests__/wizard.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import { makeRulesetOption } from '@/test/ruleset-fixtures';
import type { Locale } from '@/i18n/config';
import type { CloneSourceOption } from '@/lib/league-admin/clone-source';
import type { WizardExample, WizardFormat, WizardStart } from '@/lib/league-admin/wizard';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import NewCompetitionWizard from '../NewCompetitionWizard';

const LEAGUE_ID = '5e150000-0000-4000-8000-000000000001';
const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOM_SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const RULESET_ID = '22222222-2222-4222-8222-222222222222';
const FORMAT_ID = '33333333-3333-4333-8333-333333333333';

const classic: WizardExample = {
  id: 'classic-league',
  title: 'Classic League',
  summary: 'Round robin, then playoffs',
  overview: 'Round robin into a bracket',
  stages: [
    { key: 'rr', name: 'Group stage', detail: 'Round robin Best of 3' },
    { key: 'po', name: 'Playoffs', detail: 'Single elimination Best of 5' },
  ],
  needsLeagueRuleset: false,
  presetRulesetCount: 2,
};
const cup: WizardExample = {
  id: 'cup',
  title: 'Cup Bracket',
  summary: null,
  overview: 'One knockout bracket',
  stages: [{ key: 'ko', name: 'Knockout', detail: 'Single elimination' }],
  needsLeagueRuleset: true,
  presetRulesetCount: 0,
};
const examples = [classic, cup];

const formats: WizardFormat[] = [
  { id: FORMAT_ID, name: 'Autumn Series', version: 3, ownerName: 'Sam', mine: false },
  { id: '55555555-5555-4555-8555-555555555555', name: 'My Format', version: 1, ownerName: 'Alex', mine: true },
];

const ruleset = makeRulesetOption({ id: RULESET_ID, name: 'Gen 9 RU', base_format: 'gen9ru' });

const source: CloneSourceOption = {
  id: SOURCE_ID,
  name: 'Autumn League',
  format_type: 'doubles',
  status: 'completed',
  archived: false,
  is_test_season: false,
  ruleset_id: RULESET_ID,
  route_theme: 'sakura',
  language: 'en',
  description: 'Two on two.',
  phase_count: 3,
  participant_count: 12,
};
const customSource: CloneSourceOption = { ...source, id: CUSTOM_SOURCE_ID, name: 'Studio League', format_type: 'custom' };

type Props = React.ComponentProps<typeof NewCompetitionWizard>;
const baseProps: Props = { examples, formats, rulesets: [ruleset], sources: [source, customSource], isSiteAdmin: false, initialStart: null };

function renderWizard(props: Partial<Props> = {}, locale: Locale = 'en') {
  return render(withI18n(<NewCompetitionWizard {...baseProps} {...props} />, { locale }));
}

const radio = (name: RegExp) => screen.getByRole('radio', { name });
const button = (name: RegExp | string) => screen.getByRole('button', { name });
const rail = () => screen.getByRole('complementary');
const sourceSelect = () => document.getElementById('clone-source') as HTMLSelectElement;
const stepHeading = () => document.getElementById('wizard-step-heading') as HTMLElement;

async function typeName(user: ReturnType<typeof userEvent.setup>, name = 'Spring League') {
  await user.type(screen.getByLabelText('League Name'), name);
}

let fetchMock: ReturnType<typeof vi.fn>;
const bodyOfPost = (): Record<string, unknown> => JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

function respond(result: unknown) {
  fetchMock.mockResolvedValue({ json: async () => result });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  respond({ success: true, data: { id: LEAGUE_ID } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('starting point step', () => {
  it('lists the steps, the examples, the formats, the blank league and the copy option, with nothing picked', () => {
    renderWizard();

    const steps = within(screen.getByRole('list', { name: 'Steps' }));
    expect(steps.getByText('Starting point')).toBeTruthy();
    expect(steps.getByText('Details')).toBeTruthy();
    expect(steps.getByText('Review and create')).toBeTruthy();
    expect(stepHeading().textContent).toBe('Starting point');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();

    expect(radio(/^Classic League/)).toBeTruthy();
    expect(radio(/^Cup Bracket/)).toBeTruthy();
    expect(radio(/^Autumn Series/).textContent).toBe('');
    expect(screen.getByText('Version 3 · by Sam')).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(radio(/^Blank league/)).toBeTruthy();
    expect(radio(/^Copy a league/)).toBeTruthy();
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByText('Selected')).toBeNull();
    expect(within(rail()).getByText('Pick a starting point to see what it creates.')).toBeTruthy();
  });

  it('says how many stages an example has', () => {
    renderWizard();
    expect(screen.getByText('2 stages')).toBeTruthy();
    expect(screen.getByText('1 stage')).toBeTruthy();
  });

  it('Continue with nothing picked shows the "pick a starting point" alert and stays on the step', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(button('Continue'));

    expect(screen.getByRole('alert').textContent).toBe('Pick a starting point to continue.');
    expect(stepHeading().textContent).toBe('Starting point');
  });

  it('picking a start clears the alert, marks the choice and lets Continue go on', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(button('Continue'));

    await user.click(radio(/^Blank league/));

    expect(screen.queryByRole('alert')).toBeNull();
    expect((radio(/^Blank league/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Selected')).toBeTruthy();
    await user.click(button('Continue'));
    expect(stepHeading().textContent).toBe('Details');
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
  });

  it('moves focus to the heading of the next step', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });

    expect(document.activeElement).not.toBe(stepHeading());
    await user.click(button('Continue'));

    expect(document.activeElement).toBe(stepHeading());
  });

  it('preselects the start a link named, so Continue goes straight to the details', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'preset', id: 'cup' } });

    expect((radio(/^Cup Bracket/) as HTMLInputElement).checked).toBe(true);
    expect((radio(/^Classic League/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(within(rail()).getByText('Cup Bracket, your private copy')).toBeTruthy();

    await user.click(button('Continue'));
    expect(stepHeading().textContent).toBe('Details');
  });

  it('preselects a published format', () => {
    renderWizard({ initialStart: { kind: 'format', id: FORMAT_ID } });

    expect((radio(/^Autumn Series/) as HTMLInputElement).checked).toBe(true);
    expect((radio(/^My Format/) as HTMLInputElement).checked).toBe(false);
  });

  it('without published formats it says so and links to Formats', () => {
    renderWizard({ formats: [] });

    expect(screen.getByText('No published format yet. Build one in Formats, or start from an example.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Formats' }).getAttribute('href')).toBe('/admin/formats');
  });

  it('without a league to copy it offers no copy start; a custom league is never a source', () => {
    renderWizard({ sources: [] });
    expect(screen.queryByRole('radio', { name: /^Copy a league/ })).toBeNull();
    expect(screen.getByText('There is no league to copy yet.')).toBeTruthy();

    cleanup();
    renderWizard({ sources: [customSource] });
    expect(screen.queryByRole('radio', { name: /^Copy a league/ })).toBeNull();
    expect(screen.getByText('There is no league to copy yet.')).toBeTruthy();
  });

  it('Cancel leads back to the league list', () => {
    renderWizard();
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/admin/leagues');
  });
});

describe('"What gets created" rail', () => {
  it('lists what an example creates: the private copy, each stage, its rulesets and what to do afterwards', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(radio(/^Classic League/));

    const aside = within(rail());
    expect(aside.getByText('What gets created')).toBeTruthy();
    expect(aside.getByText('A custom-format league')).toBeTruthy();
    expect(aside.getByText('Classic League, your private copy')).toBeTruthy();
    expect(aside.getByText('Stage “Group stage”')).toBeTruthy();
    expect(aside.getByText('Round robin Best of 3')).toBeTruthy();
    expect(aside.getByText('Stage “Playoffs”')).toBeTruthy();
    expect(aside.getByText('Single elimination Best of 5')).toBeTruthy();
    expect(aside.getByText('2 rulesets from the example')).toBeTruthy();
    expect(aside.getByText('Add the players')).toBeTruthy();
    expect(aside.getByText('Work through the readiness list on the overview')).toBeTruthy();
    expect(aside.getByText('Set the league to active')).toBeTruthy();
    expect(aside.queryByText('Add the phases')).toBeNull();
  });

  it('names no rulesets for an example that brings none', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(radio(/^Cup Bracket/));

    expect(within(rail()).getByText('Stage “Knockout”')).toBeTruthy();
    expect(within(rail()).queryByText(/ruleset.* from the example/)).toBeNull();
  });

  it('says a single ruleset in the singular', async () => {
    const user = userEvent.setup();
    renderWizard({ examples: [{ ...classic, presetRulesetCount: 1 }] });
    await user.click(radio(/^Classic League/));
    expect(within(rail()).getByText('1 ruleset from the example')).toBeTruthy();
  });

  it('shows an attached format with its version and the readiness list', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(radio(/^Autumn Series/));

    const aside = within(rail());
    expect(aside.getByText('Autumn Series, version 3')).toBeTruthy();
    expect(aside.getByText('Attached as published. Its stages become the league’s phases.')).toBeTruthy();
    expect(aside.getByText('Work through the readiness list on the overview')).toBeTruthy();
  });

  it('a blank league creates no phases yet; a copy takes the phases of its source', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(radio(/^Blank league/));
    expect(within(rail()).getByText('A league')).toBeTruthy();
    expect(within(rail()).getByText('No phases yet: add them afterwards, or attach a format.')).toBeTruthy();
    expect(within(rail()).getByText('Add the phases')).toBeTruthy();
    expect(within(rail()).queryByText('Work through the readiness list on the overview')).toBeNull();

    await user.click(radio(/^Copy a league/));
    expect(within(rail()).getByText(/^Phases and settings of the league you pick/)).toBeTruthy();
    expect(within(rail()).queryByText('Add the phases')).toBeNull();
  });

  it('shows the name once it is typed', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    await typeName(user, 'Spring League');

    expect(within(rail()).getByText('Spring League')).toBeTruthy();
  });
});

describe('details step', () => {
  it('refuses an empty name and says so at the field', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    await user.click(button('Continue'));

    expect(stepHeading().textContent).toBe('Details');
    expect(screen.getByText('Give the league a name.')).toBeTruthy();
    await typeName(user, 'x');
    expect(screen.queryByText('Give the league a name.')).toBeNull();
  });

  it('refuses a name of spaces only', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));
    await typeName(user, '   ');

    await user.click(button('Continue'));

    expect(screen.getByText('Give the league a name.')).toBeTruthy();
    expect(stepHeading().textContent).toBe('Details');
  });

  it('refuses an end date before the start date', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));
    await typeName(user);
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2027-03-02' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2027-03-01' } });

    await user.click(button('Continue'));

    expect(screen.getByText('The end date must not be before the start date.')).toBeTruthy();
    expect(stepHeading().textContent).toBe('Details');

    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2027-03-02' } });
    await user.click(button('Continue'));
    expect(stepHeading().textContent).toBe('Review and create');
  });

  it('wants a league ruleset for an example whose stages play under it', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'preset', id: 'cup' } });
    await user.click(button('Continue'));
    await typeName(user);

    expect(screen.getByLabelText('League ruleset')).toBeTruthy();
    expect(screen.getByText('The stages of this format play under the league’s ruleset, so the league needs one.')).toBeTruthy();
    await user.click(button('Continue'));

    expect(screen.getByText('Pick the ruleset the stages play under.')).toBeTruthy();
    expect(stepHeading().textContent).toBe('Details');

    await user.selectOptions(screen.getByLabelText('League ruleset'), RULESET_ID);
    await user.click(button('Continue'));
    expect(stepHeading().textContent).toBe('Review and create');
  });

  it('an example that brings its own rulesets needs none from the league', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'preset', id: 'classic-league' } });
    await user.click(button('Continue'));
    await typeName(user);

    expect(screen.getByLabelText('Battle ruleset (optional)')).toBeTruthy();
    expect(screen.getByText('Needed only when a stage of the format plays under the league’s ruleset.')).toBeTruthy();
    await user.click(button('Continue'));

    expect(stepHeading().textContent).toBe('Review and create');
  });

  it('a copy without a source cannot continue', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'copy' } });
    await user.click(button('Continue'));
    await typeName(user);

    await user.click(button('Continue'));

    expect(screen.getByRole('alert').textContent).toBe('Pick the league to copy.');
    expect(stepHeading().textContent).toBe('Details');

    await user.selectOptions(sourceSelect(), SOURCE_ID);
    await user.click(button('Continue'));
    expect(stepHeading().textContent).toBe('Review and create');
  });

  it('a start from a format has no league type field (the league is custom)', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'format', id: FORMAT_ID } });
    await user.click(button('Continue'));

    expect(screen.queryByLabelText('League type')).toBeNull();
    expect(screen.getByLabelText('Battle ruleset (optional)')).toBeTruthy();
  });

  it('a blank league offers the league types in order, defaulting to Classic: Singles', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    const select = screen.getByLabelText('League type') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom']);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Classic: Singles',
      'Classic: Doubles',
      'Draft',
      'Evolution Point Buy',
      'Custom format (Format Studio)',
    ]);
    expect(select.value).toBe('singles');
    expect(screen.getByLabelText('Battle ruleset (optional)')).toBeTruthy();
    expect(screen.queryByText('Battle format: Singles (fixed)')).toBeNull();
  });

  it('offers the picked ruleset for a classic or a custom league, without a fixed battle format', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    for (const type of ['singles', 'custom']) {
      await user.selectOptions(screen.getByLabelText('League type'), type);
      const select = screen.getByLabelText('Battle ruleset (optional)') as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toEqual(['No default ruleset', 'Gen 9 RU']);
      expect(screen.queryByText('Battle format: Singles (fixed)')).toBeNull();
      expect(screen.queryByTestId('league-auto-ruleset')).toBeNull();
    }
  });

  it('a point-buy league fixes singles and sets its ruleset automatically (no ruleset select)', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    await user.selectOptions(screen.getByLabelText('League type'), 'evolution_point_buy');

    expect(screen.getByText('Battle format: Singles (fixed)')).toBeTruthy();
    expect(screen.getByText('Battle ruleset: Evolution Point Buy (set automatically)')).toBeTruthy();
    expect(screen.queryByLabelText('Battle ruleset (optional)')).toBeNull();
    expect(screen.queryByText('Gen 9 RU')).toBeNull();
  });

  it('defaults the content language to German and offers both languages by their own names', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    const select = screen.getByLabelText('Content language (Discord, reports, overlays)') as HTMLSelectElement;
    expect(select.value).toBe('de');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['en', 'English'],
      ['de', 'Deutsch'],
    ]);
  });

  it('picking a source takes over the settings a new league repeats, but not the name or the dates', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'copy' } });
    await user.click(button('Continue'));
    await typeName(user, 'Spring League');
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2027-03-01' } });

    await user.selectOptions(sourceSelect(), SOURCE_ID);

    expect((screen.getByLabelText('League type') as HTMLSelectElement).value).toBe('doubles');
    expect((screen.getByLabelText('Battle ruleset (optional)') as HTMLSelectElement).value).toBe(RULESET_ID);
    expect((screen.getByLabelText('Content language (Discord, reports, overlays)') as HTMLSelectElement).value).toBe('en');
    expect((screen.getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe('Two on two.');
    expect((screen.getByLabelText('League Name') as HTMLInputElement).value).toBe('Spring League');
    expect((screen.getByLabelText('Start Date') as HTMLInputElement).value).toBe('2027-03-01');
  });

  it('a custom league is not offered as a source', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'copy' } });
    await user.click(button('Continue'));

    const values = [...(sourceSelect() as HTMLSelectElement).options].map((o) => o.value);
    expect(values).toContain(SOURCE_ID);
    expect(values).not.toContain(CUSTOM_SOURCE_ID);
  });

  it('the league admins can be copied by a site admin only, and a new source resets both options', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'copy' }, isSiteAdmin: true });
    await user.click(button('Continue'));
    await user.selectOptions(sourceSelect(), SOURCE_ID);
    await user.click(document.getElementById('clone-copy-roster') as HTMLElement);
    await user.click(document.getElementById('clone-copy-admins') as HTMLElement);
    expect((document.getElementById('clone-copy-roster') as HTMLInputElement).checked).toBe(true);

    await user.selectOptions(sourceSelect(), '');
    await user.selectOptions(sourceSelect(), SOURCE_ID);

    expect((document.getElementById('clone-copy-roster') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('clone-copy-admins') as HTMLInputElement).checked).toBe(false);

    cleanup();
    renderWizard({ initialStart: { kind: 'copy' }, isSiteAdmin: false });
    await user.click(button('Continue'));
    await user.selectOptions(sourceSelect(), SOURCE_ID);
    expect(document.getElementById('clone-copy-roster')).not.toBeNull();
    expect(document.getElementById('clone-copy-admins')).toBeNull();
  });

  it('Back returns to the starting point with the choice kept', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));

    await user.click(button('Back'));

    expect(stepHeading().textContent).toBe('Starting point');
    expect((radio(/^Blank league/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('review step', () => {
  async function toReview(user: ReturnType<typeof userEvent.setup>, start: WizardStart, extra?: () => Promise<void>) {
    renderWizard({ initialStart: start });
    await user.click(button('Continue'));
    await typeName(user, '  Spring League ');
    if (extra) await extra();
    await user.click(button('Continue'));
  }

  const rows = () => within(document.querySelector('dl') as HTMLElement);

  it('shows the choices, and says nothing exists yet', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'blank' }, async () => {
      await user.type(screen.getByLabelText('Description (optional)'), 'About us');
      await user.selectOptions(screen.getByLabelText('Battle ruleset (optional)'), RULESET_ID);
      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2027-03-01' } });
      fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2027-05-01' } });
    });

    expect(stepHeading().textContent).toBe('Review and create');
    expect(screen.getByText('Nothing exists yet. Check the details, then create the league.')).toBeTruthy();
    const dl = (document.querySelector('dl') as HTMLElement).textContent as string;
    expect(dl).toContain('Starting pointBlank league');
    expect(dl).toContain('NameSpring League');
    expect(dl).toContain('League typeClassic: Singles');
    expect(dl).toContain('RulesetGen 9 RU');
    expect(dl).toContain('Content languageDeutsch');
    expect(dl).toContain('DescriptionAbout us');
    expect(dl).toMatch(/Dates.+ to .+/);
    expect(dl).not.toContain('Not set');
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('says what is unset in words', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'blank' });

    const dl = (document.querySelector('dl') as HTMLElement).textContent as string;
    expect(dl).toContain('RulesetNone');
    expect(dl).toContain('DatesNot set');
    expect(dl).toContain('DescriptionNone');
  });

  it('a point-buy league shows its ruleset as set automatically', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'blank' }, async () => {
      await user.selectOptions(screen.getByLabelText('League type'), 'evolution_point_buy');
    });

    expect((document.querySelector('dl') as HTMLElement).textContent).toContain('RulesetSet automatically');
  });

  it('an example start says the creation is all or nothing, and names the example and a custom league', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'preset', id: 'classic-league' });

    expect(screen.getByText('Nothing exists yet. Creating makes all of this at once; if any part fails, nothing is created.')).toBeTruthy();
    const dl = (document.querySelector('dl') as HTMLElement).textContent as string;
    expect(dl).toContain('Starting pointClassic League');
    expect(dl).toContain('League typeCustom format (Format Studio)');
  });

  it('a copy names its source and what it takes along', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'copy' }, isSiteAdmin: true });
    await user.click(button('Continue'));
    await typeName(user);
    await user.selectOptions(sourceSelect(), SOURCE_ID);
    await user.click(document.getElementById('clone-copy-roster') as HTMLElement);
    await user.click(document.getElementById('clone-copy-admins') as HTMLElement);
    await user.click(button('Continue'));

    expect((document.querySelector('dl') as HTMLElement).textContent).toContain(
      'Starting pointCopy of Autumn League, with its players, with its league admins',
    );
  });

  it('Change returns to the step that holds the value, with everything typed kept', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'blank' });

    await user.click(rows().getByRole('button', { name: 'Change: Name' }));
    expect(stepHeading().textContent).toBe('Details');
    expect((screen.getByLabelText('League Name') as HTMLInputElement).value).toBe('  Spring League ');

    await user.click(button('Continue'));
    await user.click(rows().getByRole('button', { name: 'Change: Starting point' }));
    expect(stepHeading().textContent).toBe('Starting point');
    expect((radio(/^Blank league/) as HTMLInputElement).checked).toBe(true);
  });

  it('the league type of a format start is changed where the format is picked', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'format', id: FORMAT_ID });

    await user.click(rows().getByRole('button', { name: 'Change: League type' }));

    expect(stepHeading().textContent).toBe('Starting point');
  });

  it('Back from the review returns to the details', async () => {
    const user = userEvent.setup();
    await toReview(user, { kind: 'blank' });

    await user.click(button('Back'));

    expect(stepHeading().textContent).toBe('Details');
  });
});

describe('Create', () => {
  async function createFrom(user: ReturnType<typeof userEvent.setup>, start: WizardStart, props: Partial<Props> = {}, extra?: () => Promise<void>) {
    renderWizard({ initialStart: start, ...props });
    await user.click(button('Continue'));
    await typeName(user);
    if (extra) await extra();
    await user.click(button('Continue'));
    await user.click(button('Create league'));
  }

  it('an example: custom league with from_format.preset_id and the ruleset, then the overview', async () => {
    const user = userEvent.setup();
    respond({ success: true, data: { season: { id: LEAGUE_ID } } });

    await createFrom(user, { kind: 'preset', id: 'cup' }, {}, async () => {
      await user.selectOptions(screen.getByLabelText('League ruleset'), RULESET_ID);
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/seasons');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(bodyOfPost()).toEqual({
      name: 'Spring League',
      format_type: 'custom',
      ruleset_id: RULESET_ID,
      start_date: null,
      end_date: null,
      route_theme: 'auto',
      language: 'de',
      from_format: { preset_id: 'cup' },
    });
  });

  it('a published format: attaches the listed version, then the overview (not the Format tab)', async () => {
    const user = userEvent.setup();
    respond({ success: true, data: { season: { id: LEAGUE_ID } } });

    await createFrom(user, { kind: 'format', id: FORMAT_ID });

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID));
    expect(bodyOfPost()).toMatchObject({ format_type: 'custom', ruleset_id: null, from_format: { definition_id: FORMAT_ID, version_no: 3 } });
    expect(bodyOfPost()).not.toHaveProperty('clone_from');
  });

  it('a blank classic league: the plain create body, then the overview', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'blank' }, {}, async () => {
      await user.selectOptions(screen.getByLabelText('League type'), 'draft');
      await user.selectOptions(screen.getByLabelText('Battle ruleset (optional)'), RULESET_ID);
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID));
    expect(bodyOfPost()).toEqual({
      name: 'Spring League',
      format_type: 'draft',
      ruleset_id: RULESET_ID,
      start_date: null,
      end_date: null,
      route_theme: 'auto',
      language: 'de',
    });
  });

  it('a blank custom league lands on the Format tab, where its format is attached', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'blank' }, {}, async () => {
      await user.selectOptions(screen.getByLabelText('League type'), 'custom');
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID + '?tab=format'));
  });

  it('a blank point-buy league sends no ruleset, even one picked before the switch', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'blank' }, {}, async () => {
      await user.selectOptions(screen.getByLabelText('Battle ruleset (optional)'), RULESET_ID);
      await user.selectOptions(screen.getByLabelText('League type'), 'evolution_point_buy');
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(bodyOfPost()).toMatchObject({ format_type: 'evolution_point_buy', ruleset_id: null });
  });

  it('a copy: carries clone_from with the roster choice, never copy_admins for a plain admin', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'copy' }, {}, async () => {
      await user.selectOptions(sourceSelect(), SOURCE_ID);
      await user.click(document.getElementById('clone-copy-roster') as HTMLElement);
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID));
    expect(bodyOfPost()).toEqual({
      name: 'Spring League',
      description: 'Two on two.',
      format_type: 'doubles',
      ruleset_id: RULESET_ID,
      start_date: null,
      end_date: null,
      route_theme: 'sakura',
      language: 'en',
      clone_from: { season_id: SOURCE_ID, copy_roster: true },
    });
  });

  it('a copy by a site admin may carry copy_admins', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'copy' }, { isSiteAdmin: true }, async () => {
      await user.selectOptions(sourceSelect(), SOURCE_ID);
      await user.click(document.getElementById('clone-copy-admins') as HTMLElement);
    });

    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(bodyOfPost().clone_from).toEqual({ season_id: SOURCE_ID, copy_roster: false, copy_admins: true });
  });

  it('a successful create keeps the button disabled while the league page loads (no second league)', async () => {
    const user = userEvent.setup();

    await createFrom(user, { kind: 'blank' });
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));

    const create = button(/Create league/) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.click(create);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect((button('Back') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a double click sends one request', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderWizard({ initialStart: { kind: 'blank' } });
    await user.click(button('Continue'));
    await typeName(user);
    await user.click(button('Continue'));

    await user.dblClick(button('Create league'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((button(/Create league/) as HTMLButtonElement).disabled).toBe(true);
    release({ json: async () => ({ success: true, data: { id: LEAGUE_ID } }) });
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('a failed create', () => {
    const failure = { success: false, error: 'The league could not be created from the source. Nothing was kept.', code: 'SEASON_CLONE_FAILED' };

    it('shows the server message on the review step, stays put, and can be retried', async () => {
      const user = userEvent.setup();
      respond(failure);

      await createFrom(user, { kind: 'blank' });

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('The league could not be created from the source. Nothing was kept.');
      expect(nav.push).not.toHaveBeenCalled();
      expect(stepHeading().textContent).toBe('Review and create');
      const create = button('Create league') as HTMLButtonElement;
      expect(create.disabled).toBe(false);

      respond({ success: true, data: { id: LEAGUE_ID } });
      await user.click(create);

      await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/leagues/' + LEAGUE_ID));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows the message of its code in German', async () => {
      const user = userEvent.setup();
      respond(failure);
      renderWizard({ initialStart: { kind: 'blank' } }, 'de');
      await user.click(button('Weiter'));
      await user.type(screen.getByLabelText('Name der Liga'), 'Frühling');
      await user.click(button('Weiter'));

      await user.click(button('Liga erstellen'));

      expect((await screen.findByRole('alert')).textContent).toBe('Die Liga konnte nicht aus der Vorlage erstellt werden. Es wurde nichts behalten.');
      expect((button('Liga erstellen') as HTMLButtonElement).disabled).toBe(false);
    });

    it('a network failure shows the common network message and stays retryable', async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await createFrom(user, { kind: 'blank' });

      expect((await screen.findByRole('alert')).textContent).toBe('Network error. Check your connection and try again.');
      expect((button('Create league') as HTMLButtonElement).disabled).toBe(false);
    });

    it('an answer with neither message nor code falls back to the wizard text', async () => {
      const user = userEvent.setup();
      respond({ success: false });

      await createFrom(user, { kind: 'blank' });

      expect((await screen.findByRole('alert')).textContent).toBe('The league could not be created.');
    });

    it('a new choice clears the old error', async () => {
      const user = userEvent.setup();
      respond(failure);
      await createFrom(user, { kind: 'blank' });
      await screen.findByRole('alert');

      await user.click(button('Back'));

      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

describe('German', () => {
  it('renders the three steps without a missing key', async () => {
    const user = userEvent.setup();
    const { container } = renderWizard({ initialStart: { kind: 'preset', id: 'classic-league' } }, 'de');
    const text = () => container.textContent ?? '';

    expect(text()).toContain('Startpunkt');
    expect(text()).toContain('Schritt 1 von 3');
    expect(text()).toContain('Was erstellt wird');
    expect(text()).toContain('Classic League, deine private Kopie');
    expect(text()).toContain('Stage „Group stage“');
    expect(text()).toContain('2 Regelwerke aus dem Beispiel');
    expect(text()).toContain('Leere Liga');
    expect(text()).toContain('Liga kopieren');
    expect(text()).toContain('Gewählt');
    expect(text()).not.toContain('Starting point');

    await user.click(button('Weiter'));
    expect(text()).toContain('Schritt 2 von 3');
    expect(text()).toContain('Name der Liga');
    expect(text()).toContain('Inhaltssprache (Discord, Berichte, Overlays)');
    await user.click(button('Weiter'));
    expect(text()).toContain('Gib der Liga einen Namen.');

    await user.type(screen.getByLabelText('Name der Liga'), 'Frühling');
    await user.click(button('Weiter'));
    expect(text()).toContain('Prüfen und erstellen');
    expect(text()).toContain('Beim Erstellen entsteht alles auf einmal');
    expect(text()).toContain('Ligatyp');
    expect(text()).toContain('Eigenes Format (Format Studio)');
    expect(text()).toContain('Nicht gesetzt');
    expect(text()).toContain('Liga erstellen');
  });

  it('keeps the league type labels of the old form in German', async () => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } }, 'de');
    await user.click(button('Weiter'));

    const select = screen.getByLabelText('Liga-Typ') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Klassisch: Einzel',
      'Klassisch: Doppel',
      'Draft',
      'Evolution Point Buy',
      'Eigenes Format (Format Studio)',
    ]);
    await user.selectOptions(select, 'evolution_point_buy');
    expect(screen.getByText('Kampfformat: Einzel (fest)')).toBeTruthy();
    expect(screen.getByText('Battle-Regelwerk: Evolution Point Buy (wird automatisch gesetzt)')).toBeTruthy();
  });

  it.each([
    ['en', 'Auto (format default)'],
    ['de', 'Automatisch (Standard des Formats)'],
  ] as const)('labels the automatic world theme in %s', async (locale, label) => {
    const user = userEvent.setup();
    renderWizard({ initialStart: { kind: 'blank' } }, locale);
    await user.click(button(locale === 'en' ? 'Continue' : 'Weiter'));

    const select = screen.getByLabelText(locale === 'en' ? '3D World Theme' : '3D-Welt-Thema') as HTMLSelectElement;
    expect(select.value).toBe('auto');
    expect(select.options[select.selectedIndex].textContent).toBe(label);
  });

  it.each([
    ['en', 'Pick a starting point to continue.'],
    ['de', 'Wähle einen Startpunkt, um fortzufahren.'],
  ] as const)('says the pick alert in %s', async (locale, text) => {
    const user = userEvent.setup();
    renderWizard({}, locale);
    await user.click(button(locale === 'en' ? 'Continue' : 'Weiter'));
    expect(screen.getByRole('alert').textContent).toBe(text);
  });
});
