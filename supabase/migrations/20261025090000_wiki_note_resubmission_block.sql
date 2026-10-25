-- A moderator can close a rejected wiki note for resubmission.
--
-- Before, an author could edit a rejected note as often as they liked and every edit re-queued it (the resubmit path of
-- 20260608100000 + the re-moderation change). The owner does not want unlimited resubmission: the superadmin gets a
-- final "block from resubmitting" action on a rejected note.
-- After:
--   wiki_notes.resubmission_blocked_at  when the superadmin closed the note for resubmission (null = not blocked).
--   wiki_notes.resubmission_blocked_by  who did it. ON DELETE SET NULL, like approved_by / rejected_by: removing that
--                                       player keeps the block.
-- The application refuses an author's edit of a blocked note and leaves it rejected. A site admin's own edit is not
-- affected. Approving a note clears the block in the same UPDATE (the application does that); the CHECK below makes the
-- invariant hold in the database: only a rejected, non-approved note can carry a block.
-- Existing rows get null, so no note is blocked by this migration.
-- No new table and no grants: the columns inherit the table privileges of public.wiki_notes. The API roles (anon,
-- authenticated) hold no table grants there (20261008081443_close_public_api_roles.sql), so only service_role reads or
-- writes them; the baseline 'Public read approved wiki_notes' policy is irrelevant without a grant. RLS stays as it is.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the application code. The code selects the columns on every
-- moderation list and note read, so before they exist those reads fail with a missing-column error.
BEGIN;

ALTER TABLE public.wiki_notes
  ADD COLUMN resubmission_blocked_at timestamptz,
  ADD COLUMN resubmission_blocked_by uuid REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.wiki_notes
  ADD CONSTRAINT wiki_notes_resubmission_block_rejected_check
  CHECK (resubmission_blocked_at IS NULL OR (approved = false AND rejected_at IS NOT NULL));

CREATE INDEX idx_wiki_notes_resubmission_blocked_by
  ON public.wiki_notes (resubmission_blocked_by)
  WHERE resubmission_blocked_by IS NOT NULL;

COMMENT ON COLUMN public.wiki_notes.resubmission_blocked_at IS
  'Set by the superadmin on a rejected note: the author can no longer edit it back into the moderation queue. Null = not blocked. Cleared when the note is approved or the block is lifted.';
COMMENT ON COLUMN public.wiki_notes.resubmission_blocked_by IS
  'The player (the superadmin) who closed the note for resubmission. Set null if that player is removed.';

COMMIT;
