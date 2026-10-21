import { kaleGenerateText } from './provider';
import { getReportDefinition } from './registry';
import { getPipelineMode } from './prompts';
import type {
  PromptTask,
  TaskResult,
  ValidationError,
  ReportParams,
} from './types';
import type { TournamentReportType, ReportContent } from '@/types/tournament-report';

const MAX_RETRIES = 2;

// ─── Public Pipeline API ────────────────────────────────────────────

export interface GenericPipelineResult {
  content: ReportContent;
  promptTokens: number;
  completionTokens: number;
  generationTimeMs: number;
  validationErrors: ValidationError[];
  retryCount: number;
  /** Model ID that actually served the requests (from the last successful call) */
  modelUsed: string;
}

/**
 * Run the Kale 2.0 pipeline for any registered report type.
 * Uses the registry to resolve the correct fact pack builder, prompts, validator, and assembler.
 */
export async function runPipeline(
  reportType: TournamentReportType,
  params: ReportParams,
  onProgress?: () => void
): Promise<GenericPipelineResult> {
  const startTime = Date.now();
  const mode = getPipelineMode();
  const definition = getReportDefinition(reportType);

  const factPack = await definition.buildFactPack(params);
  const tasks = definition.getPromptTasks(factPack, mode);

  const { results, totalPromptTokens, totalCompletionTokens, validationErrors, retryCount, modelUsed } =
    await executePipeline(
      tasks,
      (taskId, text) => definition.validate(taskId, text, factPack),
      onProgress
    );

  const content = definition.assemble(results, factPack);

  return {
    content,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    generationTimeMs: Date.now() - startTime,
    validationErrors,
    retryCount,
    modelUsed,
  };
}

/** Convenience wrapper for round recaps */
export async function runRecapPipeline(
  tournamentId: string,
  roundId: string,
  onProgress?: () => void
): Promise<GenericPipelineResult> {
  return runPipeline('round_recap', { tournamentId, roundId }, onProgress);
}

/** Convenience wrapper for round forecasts */
export async function runForecastPipeline(
  tournamentId: string,
  roundId: string,
  onProgress?: () => void
): Promise<GenericPipelineResult> {
  return runPipeline('round_forecast', { tournamentId, roundId }, onProgress);
}

// ─── Pipeline Executor ──��───────────────────────────────────────────

interface PipelineExecutionResult {
  results: Map<string, string>;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  validationErrors: ValidationError[];
  retryCount: number;
  modelUsed: string;
}

async function executePipeline(
  tasks: PromptTask[],
  validate: (taskId: string, text: string) => { valid: boolean; errors: ValidationError[] },
  onProgress?: () => void
): Promise<PipelineExecutionResult> {
  const results = new Map<string, string>();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const allValidationErrors: ValidationError[] = [];
  let retryCount = 0;
  let modelUsed = 'unknown';

  // Group tasks by stage
  const stages = new Map<number, PromptTask[]>();
  for (const task of tasks) {
    const stageTasks = stages.get(task.stage) ?? [];
    stageTasks.push(task);
    stages.set(task.stage, stageTasks);
  }

  // Execute stages sequentially, tasks within each stage in parallel
  const sortedStages = [...stages.keys()].sort((a, b) => a - b);

  for (const stageNum of sortedStages) {
    const stageTasks = stages.get(stageNum)!;

    const stageResults = await Promise.all(
      stageTasks.map(async (task) => {
        // For stage 3 narrative tasks, inject stage 1 results into the prompt
        let userPrompt = task.userPrompt;
        if (stageNum === 3 && task.id.includes('narrative')) {
          userPrompt = injectOneLinerResults(userPrompt, results);
        }

        return executeWithRetry(task, userPrompt, validate, MAX_RETRIES);
      })
    );

    for (const result of stageResults) {
      results.set(result.taskId, result.text);
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;
      allValidationErrors.push(...result.validationErrors);
      retryCount += result.retries;
      if (result.model) modelUsed = result.model;
      onProgress?.();
    }
  }

  return { results, totalPromptTokens, totalCompletionTokens, validationErrors: allValidationErrors, retryCount, modelUsed };
}

interface TaskExecutionResult {
  taskId: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
  validationErrors: ValidationError[];
  retries: number;
  model: string;
}

async function executeWithRetry(
  task: PromptTask,
  userPrompt: string,
  validate: (taskId: string, text: string) => { valid: boolean; errors: ValidationError[] },
  maxRetries: number
): Promise<TaskExecutionResult> {
  let lastResult: TaskResult | null = null;
  let lastValidation: { valid: boolean; errors: ValidationError[] } = { valid: true, errors: [] };
  let retries = 0;
  let currentPrompt = userPrompt;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await kaleGenerateText(task.systemPrompt, currentPrompt, {
        maxTokens: task.maxTokens,
      });

      lastResult = {
        id: task.id,
        text: result.content,
        promptTokens: result.prompt_tokens,
        completionTokens: result.completion_tokens,
      };

      lastValidation = validate(task.id, result.content);

      if (lastValidation.valid) {
        return {
          taskId: task.id,
          text: result.content,
          promptTokens: result.prompt_tokens,
          completionTokens: result.completion_tokens,
          validationErrors: lastValidation.errors,
          retries,
          model: result.model,
        };
      }

      // Build correction prompt for retry
      if (attempt < maxRetries) {
        const errorDescs = lastValidation.errors
          .filter((e) => e.severity === 'error')
          .map((e) => `- ${e.detail}`)
          .join('\n');

        currentPrompt = `${userPrompt}\n\nCORRECTION: Your previous response had factual errors:\n${errorDescs}\n\nPlease fix these issues while keeping the same style and tone.`;
        retries++;
        console.warn(`[kale/pipeline] Task "${task.id}" failed validation (attempt ${attempt + 1}), retrying`);
      }
    } catch (err) {
      console.error(`[kale/pipeline] Task "${task.id}" failed:`, err instanceof Error ? err.message : err);
      if (attempt === maxRetries) {
        // Return empty string — assembler will use fallback
        return {
          taskId: task.id,
          text: '',
          promptTokens: 0,
          completionTokens: 0,
          validationErrors: [{
            type: 'structural',
            detail: `Task "${task.id}" failed after ${maxRetries + 1} attempts: ${err instanceof Error ? err.message : 'unknown error'}`,
            severity: 'error',
          }],
          retries,
          model: '',
        };
      }
      retries++;
    }
  }

  // Exhausted retries — return last result with validation errors
  return {
    taskId: task.id,
    text: lastResult?.text ?? '',
    promptTokens: lastResult?.promptTokens ?? 0,
    completionTokens: lastResult?.completionTokens ?? 0,
    validationErrors: lastValidation.errors,
    retries,
    model: '',
  };
}

/**
 * Inject one-liner results from stage 1 into the narrative prompt.
 * Replaces pre-written one-liners with LLM-generated ones for richer narrative input.
 */
function injectOneLinerResults(prompt: string, results: Map<string, string>): string {
  const oneLiners: string[] = [];
  for (const [id, text] of results) {
    if (id.startsWith('match_one_liner_')) {
      oneLiners.push(`- ${text.trim()}`);
    }
  }

  if (oneLiners.length === 0) return prompt;

  return `${prompt}\n\nMatch summaries (written by you in the previous step — reference these):\n${oneLiners.join('\n')}`;
}
