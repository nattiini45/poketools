import { supabase } from '../client';

/**
 * GoTrue admin calls for the Supabase Auth user a player is linked to. `auth.users` is the source of truth for
 * email and password (`players` has no email column); there is no foreign key from `players.auth_user_id`.
 */

export interface AuthUserEmailState {
  email: string | null;
  emailConfirmed: boolean;
}

/** The linked user's email and whether it is confirmed, or null when GoTrue answers an error or has no such user. */
export async function getAuthUserEmailState(authUserId: string): Promise<AuthUserEmailState | null> {
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data.user) return null;
  return { email: data.user.email ?? null, emailConfirmed: !!data.user.email_confirmed_at };
}

/** Set a new password through the admin API; throws the GoTrue error. */
export async function setAuthUserPassword(authUserId: string, password: string): Promise<void> {
  const { error } = await supabase.auth.admin.updateUserById(authUserId, { password });
  if (error) throw error;
}

/** Remove the Supabase Auth user so no orphaned login remains after its player is deleted; throws the GoTrue error. */
export async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(authUserId);
  if (error) throw error;
}
