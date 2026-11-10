/** @vitest-environment jsdom */
/**
 * The submit button of the create/edit forms and the EPB import panel: one submission at a time, a failure stays
 * retryable, an edit form can save again, a dry run leaves the import open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import { makeRulesetOption } from '@/test/ruleset-fixtures';
import TournamentForm from '@/components/tournament/TournamentForm';
import LeagueForm from '@/components/league/LeagueForm';
import EpbImportPanel from '@/components/league/EpbImportPanel';

const RULESET_ID = '11111111-1111-4111-8111-111111111111';
const rulesets = [makeRulesetOption({ id: RULESET_ID, name: 'Standard Rules' })];
const tournament = { name: 'Spring Cup', bracket_type: 'single_elim' as const, ruleset_id: RULESET_ID, best_of_default: 3 };

const submitButton = (container: HTMLElement) => container.querySelector('button[type="submit"]') as HTMLButtonElement;

afterEach(() => vi.unstubAllGlobals());

describe('TournamentForm submit', () => {
  it('a failed create shows the error and stays retryable', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw Object.assign(new Error('Ruleset not found'), { error: 'Ruleset not found', code: 'ruleset_not_found' });
    });
    const { container } = render(withI18n(<TournamentForm rulesets={rulesets} initialData={tournament} onSubmit={onSubmit} />));
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(submitButton(container).disabled).toBe(false);
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('a successful create keeps the button disabled while the new page loads (no second tournament)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    const { container } = render(withI18n(<TournamentForm rulesets={rulesets} initialData={tournament} onSubmit={onSubmit} />));
    await user.click(submitButton(container));
    expect(submitButton(container).disabled).toBe(true);
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a double click sends one create', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { container } = render(withI18n(<TournamentForm rulesets={rulesets} initialData={tournament} onSubmit={onSubmit} />));
    await user.dblClick(submitButton(container));
    release();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('an edit form can save again after a save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    const { container } = render(withI18n(<TournamentForm mode="edit" rulesets={rulesets} initialData={tournament} onSubmit={onSubmit} />));
    await user.click(submitButton(container));
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(submitButton(container).disabled).toBe(false);
  });
});

describe('LeagueForm submit', () => {
  it('a refused create shows the error and stays retryable', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ error: 'Name taken', code: 'season_name_taken' }));
    const { container } = render(withI18n(<LeagueForm rulesets={rulesets} initialData={{ name: 'Liga' }} onSubmit={onSubmit} />));
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe('LeagueForm create', () => {
  it('a successful create keeps the button disabled while the league page loads (no second league)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => null);
    const { container } = render(withI18n(<LeagueForm rulesets={rulesets} initialData={{ name: 'Liga' }} onSubmit={onSubmit} />));
    await user.click(submitButton(container));
    expect(submitButton(container).disabled).toBe(true);
    await user.click(submitButton(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('EpbImportPanel submit', () => {
  it('a live import is final for its file; another file opens a new import', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, data: { report: { imported: 3 } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(withI18n(<EpbImportPanel seasonId="s1" seasonName="Liga" />));
    const [pointBuyFile] = Array.from(container.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await user.upload(pointBuyFile, new File(['x'], 'list.xlsx'));
    const [dryRun, importButton] = screen.getAllByRole('button').slice(0, 2) as HTMLButtonElement[];
    await user.click(importButton);
    expect(importButton.disabled).toBe(true);
    expect(dryRun.disabled).toBe(true);
    expect(importButton.textContent).toBe('Import');
    await user.click(importButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.upload(pointBuyFile, new File(['y'], 'list-v2.xlsx'));
    expect(importButton.disabled).toBe(false);
  });

  it('a dry run leaves the import open, and the import sends without the dry-run flag', async () => {
    const user = userEvent.setup();
    const sent: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: FormData }) => {
        sent.push(init.body.get('dry_run') as string | null);
        return { json: async () => ({ success: true, data: { report: { total_lines: 1, valid: 1, imported: 1 } } }) };
      }),
    );
    const { container } = render(withI18n(<EpbImportPanel seasonId="s1" seasonName="Liga" />));
    const [pointBuyFile] = Array.from(container.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await user.upload(pointBuyFile, new File(['x'], 'list.xlsx'));
    const [dryRun, importButton] = screen.getAllByRole('button').slice(0, 2) as HTMLButtonElement[];
    await user.click(dryRun);
    expect(importButton.disabled).toBe(false);
    await user.click(importButton);
    expect(sent).toEqual(['true', null]);
  });

  it('a failed import shows the error and stays retryable', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: false, error: 'Bad sheet', code: 'import_failed' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(withI18n(<EpbImportPanel seasonId="s1" seasonName="Liga" />));
    const [pointBuyFile] = Array.from(container.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await user.upload(pointBuyFile, new File(['x'], 'list.xlsx'));
    const importButton = screen.getAllByRole('button')[1] as HTMLButtonElement;
    await user.click(importButton);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(importButton.disabled).toBe(false);
    await user.click(importButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
