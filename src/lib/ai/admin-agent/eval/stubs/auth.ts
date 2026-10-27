/**
 * `@/auth` for the eval runner (`scripts/tsconfig.admin-agent-eval.json` maps the alias here). The real module starts
 * NextAuth with the Discord provider and needs its secrets; the plan stage answers every read from the fixture world and
 * never calls a guard, so nothing here ever signs anyone in. If a guard is reached by mistake it finds nobody and refuses
 * (fail closed), instead of reaching a real session.
 */
export async function auth(): Promise<null> {
  return null;
}

export async function loadSessionPlayer(): Promise<null> {
  return null;
}
