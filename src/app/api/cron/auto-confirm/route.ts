import { createLegacyAutoConfirmHandler } from '@/lib/match/auto-confirm';

export const maxDuration = 300;

const handle = createLegacyAutoConfirmHandler(() => process.env.CRON_SECRET);

export const GET = handle;
export const POST = handle;
