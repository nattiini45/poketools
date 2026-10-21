-- Placeholder: this version once carried a one-off data change of a format pack's default ban lists
-- for existing seasons (format_rules rows copied from `epb.defaults` at season creation). Its UPDATEs
-- only matched rows holding that pack's previous lists exactly, so on any other database they change
-- nothing. The file keeps its version so the migration history stays continuous; a fresh install
-- takes its ban lists from the active pack's defaults (docs/format-packs.md).
SELECT 1;
