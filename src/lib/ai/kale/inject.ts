/**
 * The narrative prompt of a Kale report gets the one-liners of stage 1 appended. Pure, and in its
 * own module so `pipeline.ts` and the AI flow eval share one copy without the eval importing the
 * pipeline (which pulls in the report registry and the database client).
 */
export function injectOneLinerResults(prompt: string, results: Map<string, string>): string {
  const oneLiners: string[] = [];
  for (const [id, text] of results) {
    if (id.startsWith('match_one_liner_')) {
      oneLiners.push(`- ${text.trim()}`);
    }
  }

  if (oneLiners.length === 0) return prompt;

  return `${prompt}\n\nMatch summaries (written by you in the previous step — reference these):\n${oneLiners.join('\n')}`;
}