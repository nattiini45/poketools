import ProfileSection from '@/components/profile/ProfileSection';
import { getT } from '@/i18n/server';
import { supplementaryRecordsMessages } from '@/i18n/messages/supplementary-records';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';

/**
 * A player's supplementary record on the profile (docs/format-packs.md, "Pack extensions"):
 * results the active pack's extension keeps outside the live pipeline, shown in their own
 * section and never added to the live numbers. Renders nothing (and runs nothing) when the pack
 * has no such provider, when supplementary records do not count for this viewer, or when the
 * player has none; a failed read says so instead of showing partial numbers.
 */
export default async function SupplementaryRecordSection({ playerId }: { playerId: string }) {
  const provider = packExtensions.supplementaryPlayerRecord;
  const result = await loadSupplement(
    'supplementaryPlayerRecord',
    provider ? (ctx) => provider(playerId, ctx) : undefined,
  );
  if (result.state === 'absent' || result.state === 'excluded') return null;
  // Read the value into a local once: `undefined` = the read failed, `null` = no record for this player.
  const record = result.state === 'ready' ? result.value : undefined;
  if (record === null) return null;

  const t = await getT(supplementaryRecordsMessages);
  if (record === undefined) {
    return (
      <ProfileSection title={t('title')} defaultCollapsed>
        <p role="status" className="text-sm text-poke-text-tertiary">
          {t('loadFailed')}
        </p>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t('title')} defaultCollapsed>
      <div className="space-y-2">
        {/* A record of honors only (no played matches known) shows no W / D / L line. */}
        {record.played > 0 && (
          <p className="text-lg font-heading font-semibold text-poke-text-primary">
            {t('profile.record', { wins: record.wins, draws: record.draws, losses: record.losses })}
          </p>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-poke-text-secondary">
          {record.played > 0 && <li>{t('profile.played', { count: record.played })}</li>}
          {record.titles > 0 && <li>{t('profile.titles', { count: record.titles })}</li>}
          {record.runnerUps > 0 && <li>{t('profile.runnerUps', { count: record.runnerUps })}</li>}
        </ul>
        <p className="text-xs text-poke-text-tertiary">{t('note')}</p>
      </div>
    </ProfileSection>
  );
}
