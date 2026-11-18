import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';

export function assertNativePhaseNotArchived(phase: { archived: boolean }): void {
  if (phase.archived) {
    throw new UserFacingError('Archived phase is read-only', { code: 'phase_bracket_archived', status: 409 });
  }
}
