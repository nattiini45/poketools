'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Section from '@/components/ui/Section';
import type { TournamentReportType } from '@/types/tournament-report';

export interface KaleTournament {
  id: string;
  name: string;
  status: string;
  season_name: string | null;
}

interface KaleConsoleProps {
  tournaments: KaleTournament[];
}

interface Round {
  id: string;
  name: string;
  round_number: number;
  status: string;
}

interface LogEntry {
  time: string;
  level: 'info' | 'error' | 'success' | 'warn';
  message: string;
}

const REPORT_TYPES: { value: TournamentReportType; label: string; description: string }[] = [
  { value: 'round_recap', label: 'Round Recap', description: 'Post-round summary of results' },
  { value: 'round_forecast', label: 'Round Forecast', description: 'Pre-round matchup predictions' },
  { value: 'season_summary', label: 'Season Summary', description: 'End-of-season wrap-up' },
  { value: 'meta_report', label: 'Meta Report', description: 'Format-level usage analysis' },
  { value: 'player_profile', label: 'Player Profile', description: 'Individual player season story' },
];

export default function KaleConsole({ tournaments }: KaleConsoleProps) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedTournament, setSelectedTournament] = useState('');
  const [selectedRound, setSelectedRound] = useState('');
  const [reportType, setReportType] = useState<TournamentReportType>('round_recap');
  const [generating, setGenerating] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const log = useCallback((level: LogEntry['level'], message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, level, message }]);
  }, []);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!selectedTournament) {
      setRounds([]);
      setSelectedRound('');
      return;
    }
    void fetch(`/api/tournaments/${selectedTournament}/rounds`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setRounds(res.data);
          log('info', `Loaded ${res.data.length} rounds for tournament`);
          if (res.data.length > 0) {
            setSelectedRound(res.data[res.data.length - 1].id);
          }
        }
      })
      .catch((err) => log('error', `Failed to load rounds: ${err.message}`));
  }, [selectedTournament, log]);

  // Generate report
  async function handleGenerate() {
    if (!selectedTournament || !selectedRound) {
      log('error', 'Select a tournament and round first');
      return;
    }

    setGenerating(true);
    setResult(null);
    log('info', `Generating ${reportType} for round ${selectedRound}...`);

    try {
      const res = await fetch('/api/ai/tournament-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: selectedTournament,
          round_id: selectedRound,
          report_type: reportType,
          force: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        log('error', `API error ${res.status}: ${text.slice(0, 200)}`);
        setGenerating(false);
        return;
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        log('error', 'No response stream');
        setGenerating(false);
        return;
      }

      let buffer = '';
      let thinkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);
            if (event.status === 'thinking') {
              thinkCount++;
              if (thinkCount % 3 === 1) {
                log('info', `Pipeline working... (heartbeat ${thinkCount})`);
              }
            } else if (event.status === 'done') {
              const model = event.model ? ` (model: ${event.model})` : '';
              log('success', `Report generated successfully${model}`);
            } else if (event.status === 'failed') {
              log('error', `Generation failed: ${event.error}`);
            }
          } catch {
            // Ignore malformed SSE
          }
        }
      }

      // Fetch the generated report
      log('info', 'Fetching generated report...');
      const reportRes = await fetch(
        `/api/tournaments/${selectedTournament}/reports?round_id=${selectedRound}&report_type=${reportType}`
      );
      if (reportRes.ok) {
        const reportData = await reportRes.json();
        if (reportData.success && reportData.data) {
          const report = Array.isArray(reportData.data) ? reportData.data[0] : reportData.data;
          if (report) {
            setResult(report.content as Record<string, unknown>);
            log('success', `Report stored. Tokens: ${report.prompt_tokens ?? '?'} in / ${report.completion_tokens ?? '?'} out | Time: ${report.generation_time_ms ?? '?'}ms`);
            if (report.error) {
              log('warn', `Validation notes: ${report.error}`);
            }
          }
        }
      }
    } catch (err) {
      log('error', `Request failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  }

  const selectedRoundData = rounds.find((r) => r.id === selectedRound);
  const selectedTournamentData = tournaments.find((t) => t.id === selectedTournament);

  /** Safely extract a string from the result object */
  const str = (key: string): string => {
    const val = result?.[key];
    return typeof val === 'string' ? val : '';
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Controls */}
      <Section>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              label="Tournament"
              value={selectedTournament}
              onChange={(e) => setSelectedTournament(e.target.value)}
              options={[
                { value: '', label: '-- Select tournament --' },
                ...tournaments.map((t) => ({
                  value: t.id,
                  label: `${t.name}${t.season_name ? ` (${t.season_name})` : ''} [${t.status}]`,
                })),
              ]}
            />

            <Select
              label="Round"
              value={selectedRound}
              onChange={(e) => setSelectedRound(e.target.value)}
              disabled={!selectedTournament}
              options={[
                { value: '', label: rounds.length ? '-- Select round --' : 'Select tournament first' },
                ...rounds.map((r) => ({
                  value: r.id,
                  label: `${r.name} [${r.status}]`,
                })),
              ]}
            />

            <Select
              label="Report Type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as TournamentReportType)}
              options={REPORT_TYPES.map((rt) => ({
                value: rt.value,
                label: rt.label,
              }))}
            />
          </div>

          {selectedTournamentData && selectedRoundData && (
            <p className="text-body text-fg-muted">
              {REPORT_TYPES.find((rt) => rt.value === reportType)?.description} for{' '}
              <span className="font-[550] text-fg">{selectedRoundData.name}</span> of{' '}
              <span className="font-[550] text-fg">{selectedTournamentData.name}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleGenerate}
              loading={generating}
              disabled={!selectedTournament || !selectedRound}
              variant="primary"
            >
              {generating ? 'Generating...' : 'Generate Report'}
            </Button>
            <Button
              onClick={() => { setLogs([]); setResult(null); }}
              variant="ghost"
              disabled={generating}
            >
              Clear
            </Button>
          </div>
        </div>
      </Section>

      {/* Log Console */}
      <Section icon="metronome" title="Console">
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-poke-md border border-hairline bg-sunken p-3 font-mono text-caption" role="log" aria-live="polite">
            {logs.length === 0 && (
              <p className="text-fg-muted">Select a tournament and round, then click Generate.</p>
            )}
            {logs.map((entry, i) => (
              <div key={i} className={`${logColor(entry.level)}`}>
                <span className="text-fg-muted">[{entry.time}]</span>{' '}
                <span className={logBadge(entry.level)}>{entry.level.toUpperCase()}</span>{' '}
                {entry.message}
              </div>
            ))}
          </div>
      </Section>

      {/* Result Preview */}
      {result && (
        <Section icon="weakness-policy" title="Generated Content">
          <div className="flex flex-col gap-4">

            {str('headline') ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Headline</h4>
                <p className="font-heading text-title text-fg">{str('headline')}</p>
              </div>
            ) : null}

            {str('narrative') ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Narrative</h4>
                <div className="max-w-[75ch] whitespace-pre-wrap text-body text-fg">
                  {str('narrative')}
                </div>
              </div>
            ) : null}

            {/* Match summaries for recaps */}
            {Array.isArray(result.match_summaries) && (result.match_summaries as Record<string, string>[]).length > 0 ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Match Summaries</h4>
                <div className="space-y-2">
                  {(result.match_summaries as Record<string, string>[]).map((ms, i) => (
                    <div key={i} className="rounded-poke-md border border-hairline bg-elevated p-2 text-body text-fg">
                      <span className="font-[550]">{ms.winner_name}</span> def. {ms.player_1_name === ms.winner_name ? ms.player_2_name : ms.player_1_name}{' '}
                      <span className="text-fg-muted">({ms.score})</span>
                      {ms.mvp_pokemon ? <span className="text-fg-muted"> — MVP: {ms.mvp_pokemon}</span> : null}
                      <p className="mt-0.5 text-fg-muted">{ms.one_liner}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {str('standings_story') ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Standings Story</h4>
                <p className="max-w-[75ch] text-body text-fg">{str('standings_story')}</p>
              </div>
            ) : null}

            {str('meta_trends') ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Meta Trends</h4>
                <p className="max-w-[75ch] text-body text-fg">{str('meta_trends')}</p>
              </div>
            ) : null}

            {result.player_spotlight && typeof result.player_spotlight === 'object' ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Player Spotlight</h4>
                <p className="max-w-[75ch] text-body text-fg">
                  <span className="font-[550]">{String((result.player_spotlight as Record<string, string>).player_name)}</span>:{' '}
                  {String((result.player_spotlight as Record<string, string>).reason)}
                </p>
              </div>
            ) : null}

            {str('bold_prediction') ? (
              <div>
                <h4 className="mb-1 text-caption font-[550] text-fg-muted">Bold Prediction</h4>
                <p className="max-w-[75ch] text-body font-[550] text-fg">{str('bold_prediction')}</p>
              </div>
            ) : null}

            {/* Raw JSON toggle */}
            <details>
              <summary className="cursor-pointer text-caption font-[550] text-accent-ink underline-offset-2 hover:underline">
                Raw JSON
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-poke-md border border-hairline bg-sunken p-3 font-mono text-caption text-fg">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        </Section>
      )}
    </div>
  );
}

function logColor(level: LogEntry['level']): string {
  switch (level) {
    case 'error': return 'text-loss';
    case 'success': return 'text-win';
    case 'warn': return 'text-accent-ink';
    default: return 'text-fg';
  }
}

function logBadge(level: LogEntry['level']): string {
  switch (level) {
    case 'error': return 'text-loss font-[550]';
    case 'success': return 'text-win font-[550]';
    case 'warn': return 'text-accent-ink font-[550]';
    default: return 'text-fg-muted';
  }
}
