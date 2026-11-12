import { getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import TeamSheetSkeleton from '../../TeamSheetSkeleton';

export default async function LibraryEntryLoading() {
  const t = await getT(teamsLibraryMessages);
  return <TeamSheetSkeleton label={t('entry.loading')} />;
}
