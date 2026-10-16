'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
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
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <div className="space-y-4 p-1">
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
            <p className="text-sm text-poke-text-secondary">
              {REPORT_TYPES.find((rt) => rt.value === reportType)?.description} for{' '}
              <span className="font-semibold text-poke-text-primary">{selectedRoundData.name}</span> of{' '}
              <span className="font-semibold text-poke-text-primary">{selectedTournamentData.name}</span>
            </p>
          )}

          <div className="flex gap-3">
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
      </Card>

      {/* Log Console */}
      <Card>
        <div className="p-1">
          <h3 className="font-heading font-semibold text-poke-text-primary mb-2">Console</h3>
          <div className="bg-poke-bg rounded-poke-md p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
            {logs.length === 0 && (
              <p className="text-poke-text-secondary italic">Select a tournament and round, then click Generate.</p>
            )}
            {logs.map((entry, i) => (
              <div key={i} className={`${logColor(entry.level)}`}>
                <span className="text-poke-text-secondary">[{entry.time}]</span>{' '}
                <span className={logBadge(entry.level)}>{entry.level.toUpperCase()}</span>{' '}
                {entry.message}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Result Preview */}
      {result && (
        <Card>
          <div className="p-1 space-y-4">
            <h3 className="font-heading font-semibold text-poke-text-primary">Generated Content</h3>

            {str('headline') ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Headline</h4>
                <p className="text-lg font-heading font-bold text-poke-text-primary">{str('headline')}</p>
              </div>
            ) : null}

            {str('narrative') ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Narrative</h4>
                <div className="prose prose-sm text-poke-text-primary whitespace-pre-wrap">
                  {str('narrative')}
                </div>
              </div>
            ) : null}

            {/* Match summaries for recaps */}
            {Array.isArray(result.match_summaries) && (result.match_summaries as Record<string, string>[]).length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Match Summaries</h4>
                <div className="space-y-2">
                  {(result.match_summaries as Record<string, string>[]).map((ms, i) => (
                    <div key={i} className="bg-poke-bg rounded-poke-md p-2 text-sm">
                      <span className="font-semibold">{ms.winner_name}</span> def. {ms.player_1_name === ms.winner_name ? ms.player_2_name : ms.player_1_name}{' '}
                      <span className="text-poke-text-secondary">({ms.score})</span>
                      {ms.mvp_pokemon ? <span className="text-poke-text-secondary"> — MVP: {ms.mvp_pokemon}</span> : null}
                      <p className="text-poke-text-secondary mt-0.5">{ms.one_liner}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {str('standings_story') ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Standings Story</h4>
                <p className="text-sm text-poke-text-primary">{str('standings_story')}</p>
              </div>
            ) : null}

            {str('meta_trends') ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Meta Trends</h4>
                <p className="text-sm text-poke-text-primary">{str('meta_trends')}</p>
              </div>
            ) : null}

            {result.player_spotlight && typeof result.player_spotlight === 'object' ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Player Spotlight</h4>
                <p className="text-sm text-poke-text-primary">
                  <span className="font-semibold">{String((result.player_spotlight as Record<string, string>).player_name)}</span>:{' '}
                  {String((result.player_spotlight as Record<string, string>).reason)}
                </p>
              </div>
            ) : null}

            {str('bold_prediction') ? (
              <div>
                <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wide mb-1">Bold Prediction</h4>
                <p className="text-sm text-poke-text-primary font-semibold">{str('bold_prediction')}</p>
              </div>
            ) : null}

            {/* Raw JSON toggle */}
            <details className="mt-4">
              <summary className="text-xs text-poke-text-secondary cursor-pointer hover:text-poke-text-primary">
                Raw JSON
              </summary>
              <pre className="mt-2 bg-poke-bg rounded-poke-md p-3 text-xs overflow-x-auto max-h-96 overflow-y-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        </Card>
      )}
    </div>
  );
}

function logColor(level: LogEntry['level']): string {
  switch (level) {
    case 'error': return 'text-poke-danger';
    case 'success': return 'text-poke-success';
    case 'warn': return 'text-poke-warning';
    default: return 'text-poke-text-primary';
  }
}

function logBadge(level: LogEntry['level']): string {
  switch (level) {
    case 'error': return 'text-poke-danger font-bold';
    case 'success': return 'text-poke-success font-bold';
    case 'warn': return 'text-poke-warning font-bold';
    default: return 'text-poke-text-secondary';
  }
}
