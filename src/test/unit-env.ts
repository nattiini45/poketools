export function isolateUnitEnv(env: Record<string, string | undefined>): void {
  for (const name of Object.keys(env)) {
    if (name.includes('SUPABASE') || name.startsWith('LOCAL_DB_') || name === 'DATABASE_URL') {
      delete env[name];
    }
  }
  env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key';
}
