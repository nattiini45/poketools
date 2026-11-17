BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_wiki_report_submit(
  p_phase_id uuid, p_note_id uuid, p_reporter_id uuid, p_reason text,
  p_details text, p_note_updated_at timestamptz, p_report_updated_at timestamptz
) RETURNS public.phase_wiki_note_reports
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_note public.phase_wiki_notes;
  v_report public.phase_wiki_note_reports;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('inaccurate', 'spam', 'abusive', 'off_topic', 'other')
     OR char_length(p_details) > 500 THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.league_phases WHERE id = p_phase_id FOR KEY SHARE;
  SELECT * INTO v_note FROM public.phase_wiki_notes
    WHERE id = p_note_id AND phase_id = p_phase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_note.approved OR v_note.rejected_at IS NOT NULL
     OR v_note.resubmission_blocked_at IS NOT NULL THEN
    RAISE EXCEPTION 'wiki_note_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.updated_at IS DISTINCT FROM p_note_updated_at THEN
    RAISE EXCEPTION 'wiki_note_changed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_report FROM public.phase_wiki_note_reports
    WHERE note_id = p_note_id AND reporter_id = p_reporter_id FOR UPDATE;
  IF v_report.updated_at IS DISTINCT FROM p_report_updated_at THEN
    RAISE EXCEPTION 'wiki_report_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_report.id IS NULL THEN
    INSERT INTO public.phase_wiki_note_reports (note_id, reporter_id, reason, details)
      VALUES (p_note_id, p_reporter_id, p_reason, p_details) RETURNING * INTO v_report;
  ELSE
    UPDATE public.phase_wiki_note_reports SET reason = p_reason, details = p_details, status = 'open',
      updated_at = greatest(clock_timestamp(), v_report.updated_at + interval '1 microsecond')
      WHERE id = v_report.id AND status = v_report.status AND updated_at = p_report_updated_at
      RETURNING * INTO v_report;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wiki_report_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.phase_wiki_report_submit(uuid, uuid, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_wiki_report_submit(uuid, uuid, uuid, text, text, timestamptz, timestamptz) TO service_role;

COMMIT;
