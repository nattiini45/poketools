import { createLegacyProcessAggregatesHandler } from '@/lib/match/process-aggregates';

export const maxDuration = 120;

const handle = createLegacyProcessAggregatesHandler(() => process.env.CRON_SECRET);

export const GET = handle;
export const POST = handle;
