/**
 * Route handlers keep the service-role client out of their imports and log through the structured logger
 * (src/lib/logger.ts): the ESLint config rejects `@/lib/supabase/client`, `@supabase/*` and `console.*`
 * under src/app/api, `@/lib/supabase/client` in components, pages and layouts, and names every file that is
 * allowed the raw client with a reason.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { SERVICE_ROLE_CLIENT_ALLOWLIST } from '../../eslint.config.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const eslint = new ESLint({ cwd: REPO_ROOT });

async function lint(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: resolve(REPO_ROOT, filePath) });
  return result.messages.map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

describe('service-role client isolation', () => {
  it('rejects the service-role client import in a route handler', async () => {
    const messages = await lint("import { supabase } from '@/lib/supabase/client';\nexport const x = supabase;\n", 'src/app/api/zz-scratch/route.ts');
    expect(messages).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  it('rejects a relative import of the client in a route helper', async () => {
    const messages = await lint("import { supabase } from '../../../lib/supabase/client';\nexport const x = supabase;\n", 'src/app/api/zz-scratch/_lib/helper.ts');
    expect(messages).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  it('rejects @supabase/* in a route handler', async () => {
    const messages = await lint("import { createClient } from '@supabase/supabase-js';\nexport const x = createClient;\n", 'src/app/api/zz-scratch/route.ts');
    expect(messages).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  it('rejects the client import in a page and a component', async () => {
    const code = "import { supabase } from '@/lib/supabase/client';\nexport const x = supabase;\n";
    expect(await lint(code, 'src/app/zz-scratch/page.tsx')).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
    expect(await lint(code, 'src/components/zz-scratch.tsx')).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  it('keeps the @pkmn/dex restriction on components', async () => {
    const messages = await lint("import { Dex } from '@pkmn/dex';\nexport const x = Dex;\n", 'src/components/zz-scratch.tsx');
    expect(messages).toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  it('reports console calls in a route handler as errors, not warnings', async () => {
    const messages = await lint("export function f() {\n  console.error('x');\n  console.log('x');\n}\n", 'src/app/api/zz-scratch/route.ts');
    const consoleMessages = messages.filter((m) => m.ruleId === 'no-console');
    expect(consoleMessages).toHaveLength(2);
    expect(consoleMessages.every((m) => m.severity === 2)).toBe(true);
  });

  it('leaves console calls outside src/app/api alone', async () => {
    const messages = await lint("export function f() {\n  console.error('x');\n}\n", 'src/lib/zz-scratch.ts');
    expect(messages.filter((m) => m.ruleId === 'no-console')).toEqual([]);
  });

  it('lets a test file mock the client', async () => {
    const messages = await lint("import { supabase } from '@/lib/supabase/client';\nexport const x = supabase;\n", 'src/app/api/zz-scratch/__tests__/route.test.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  it('names a reason for every allow-listed file', () => {
    for (const entry of SERVICE_ROLE_CLIENT_ALLOWLIST) {
      expect(entry.file).toMatch(/^src\/app\/api\/.+\.ts$/);
      expect(entry.reason.trim().length).toBeGreaterThan(10);
    }
  });
});
