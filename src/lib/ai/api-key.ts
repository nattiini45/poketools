/**
 * The Anthropic API key every AI feature uses: `ANTHROPIC_API_KEY`, or the deprecated `CLAUDE_API_KEY` when only that is
 * set (older deployments). Empty and whitespace-only values count as unset. Read per call, so tests can change the env.
 */
export function anthropicApiKey(): string {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim() || (process.env.CLAUDE_API_KEY ?? '').trim();
}
