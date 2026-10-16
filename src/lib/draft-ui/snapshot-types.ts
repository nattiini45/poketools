/**
 * Draft DTOs and unions for the draft UI (draft-frontend §2.4; critique S8).
 * Re-exports only: `src/types/draft-queue.ts` (owner DC-0) is the single
 * declaration. Nothing is declared here.
 */
export type {
  LineId,
  UtilityKey,
  PriceTabKey,
  DraftKind,
  DraftMode,
  DraftPhase,
  PoolStatus,
  SlotKind,
  SlotStatus,
  ExtensionKind,
  PauseReason,
  ActorRole,
  ReasonCode,
  ReasonDTO,
  DraftConfig,
  DraftConfigInput,
  AdminPoolSummary,
  AdminSubmissionDTO,
  DraftSnapshotDTO,
  DraftSnapshotPool,
  DraftSnapshotConfig,
  DraftSnapshotParticipant,
  DraftActiveSlot,
  DraftUpcomingSlot,
  DraftSnapshotPick,
  DraftSnapshotRedraft,
  DraftSnapshotViewer,
  DraftRecentEvent,
  DraftApiErrorBody,
  MyTurnDTO,
  TokenOverviewDTO,
  TokenRefusalCode,
  RedraftSubmissionDTO,
  AuditEntryDTO,
  DraftAuditAction,
} from '@/types/draft-queue';
export { DRAFT_AUDIT_ACTIONS, DEFAULT_DRAFT_CONFIG } from '@/types/draft-queue';
