/**
 * The only door from the draft room to the admin code (owner feedback
 * 2026-10-18): a dynamic import, so the bundler puts `RoomAdminSheet` and the
 * admin sections in their own chunk. `DraftToolClient` calls it only for a
 * pool admin (Admin button hover/focus/click), so players never download it.
 * Nothing under `src/components/draft-tool` may import `draft-admin` at
 * runtime any other way (`admin-sheet.test.tsx` checks).
 */
export function loadRoomAdminSheet() {
  return import('@/components/draft-admin/RoomAdminSheet');
}
