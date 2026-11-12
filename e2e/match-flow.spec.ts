import { DEV_SEED_ADMIN, DEV_SEED_PASSWORD, devSeedPlayerEmail } from '../src/lib/dev-seed/constants';
import { signIn } from './support/auth';
import { expect, test } from './support/fixtures';
import { serviceClient } from './support/stack';
import { createScheduledMatch, seededLeague, seedPlayerId, type SeededLeague } from './support/seed';
import type { Page } from '@playwright/test';

/** A standings row's games played and wins, read from the public tournament page. */
async function standingsRow(page: Page, tournamentId: string, name: string): Promise<{ games: number; wins: number }> {
  await page.goto(`/tournaments/${tournamentId}`);
  const row = page.getByRole('table').first().getByRole('row', { name: new RegExp(`${name}\\b`) });
  await expect(row).toBeVisible();
  const cells = row.getByRole('cell');
  return { games: Number(await cells.nth(2).innerText()), wins: Number(await cells.nth(3).innerText()) };
}

/** What the standings must show for a player: the completed matches of the tournament, counted in the database. */
async function completedMatches(tournamentId: string, playerId: string): Promise<{ games: number; wins: number }> {
  const { data, error } = await serviceClient()
    .from('matches')
    .select('winner_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`);
  if (error) throw new Error(`[e2e] could not count matches: ${error.message}`);
  return { games: data.length, wins: data.filter((match) => match.winner_id === playerId).length };
}

test.describe.serial('a reported result is confirmed by the opponent', () => {
  let league: SeededLeague;
  let matchId: string;
  let reporterId: string;
  let opponentId: string;

  test.beforeAll(async () => {
    league = await seededLeague();
    reporterId = await seedPlayerId('Seed Player 7');
    opponentId = await seedPlayerId('Seed Player 8');
    matchId = await createScheduledMatch(league, reporterId, opponentId);
  });

  test('the reporter submits a result, the opponent confirms it and the standings move', async ({ page, newPage }) => {
    const before = await completedMatches(league.tournamentId, reporterId);

    const reporter = await newPage();
    await signIn(reporter, devSeedPlayerEmail(7), DEV_SEED_PASSWORD);
    const report = await reporter.request.post('/api/manual-result', {
      data: {
        match_id: matchId,
        winner_id: reporterId,
        pokemon_stats: [
          { player_id: reporterId, pokemon: [{ pokemon_name: 'Pikachu', kos_dealt: 1 }] },
          { player_id: opponentId, pokemon: [{ pokemon_name: 'Eevee', was_koed: true }] },
        ],
      },
    });
    expect(report.ok(), await report.text()).toBe(true);

    const opponent = await newPage();
    await signIn(opponent, devSeedPlayerEmail(8), DEV_SEED_PASSWORD);
    await opponent.goto(`/dashboard/confirm/${matchId}`);
    await expect(opponent.getByRole('heading', { name: 'Confirm Match Result' })).toBeVisible();
    await opponent.getByRole('button', { name: 'Confirm Result' }).click();
    await expect(opponent.getByText('Match confirmed! Result is now final.')).toBeVisible();

    // The standings are compared with the database after the confirm, not with what the page showed before it.
    const after = await completedMatches(league.tournamentId, reporterId);
    expect(after).toEqual({ games: before.games + 1, wins: before.wins + 1 });
    await expect
      .poll(() => standingsRow(page, league.tournamentId, 'Seed Player 7'), { message: 'standings of the reporter' })
      .toEqual(after);
  });

  test('an admin sees the match and its history', async ({ newPage }) => {
    const admin = await newPage();
    await signIn(admin, DEV_SEED_ADMIN.email, DEV_SEED_ADMIN.password);
    await admin.goto(`/admin/matches/${matchId}`);
    // The page heading is the pairing (its score plates are decorative); the pairing is also the breadcrumb's last step.
    await expect(admin.getByRole('heading', { level: 1, name: 'Seed Player 7 vs Seed Player 8' })).toBeVisible();
    await expect(admin.getByText('Seed Player 7 vs Seed Player 8').first()).toBeVisible();
    await expect(admin.getByRole('button', { name: /History/ })).toBeVisible();

    // A player's report is not an audited admin action, so the history starts empty and the reopen is its first entry.
    await expect(admin.getByText('Nothing has been recorded for this match yet.')).toBeVisible();
    await admin.getByRole('button', { name: 'Reopen match' }).click();
    const dialog = admin.getByRole('dialog', { name: 'Reopen this match?' });
    await dialog.getByLabel('Reason for reopening').fill('e2e: checking the match history panel');
    await dialog.getByRole('button', { name: 'Reopen match' }).click();
    await expect(admin.getByText('The match was reopened.')).toBeVisible();

    await admin.reload();
    await expect(admin.getByText(/Showing 1 of 1/)).toBeVisible();
    await expect(admin.getByText('e2e: checking the match history panel')).toBeVisible();
  });
});
