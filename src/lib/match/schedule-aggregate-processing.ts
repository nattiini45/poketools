import { after } from 'next/server';
import { processAggregateJobs } from '@/lib/match/aggregate-queue';

export function scheduleAggregateProcessing(limit = 5): void {
  const run = async () => {
    try {
      await processAggregateJobs(limit);
    } catch (err) {
      console.error('[schedule-aggregate-processing] Failed to process aggregate jobs:', err);
    }
  };

  try {
    after(run);
  } catch {
    void run();
  }
}