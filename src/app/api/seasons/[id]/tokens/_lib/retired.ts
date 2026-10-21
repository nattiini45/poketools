/**
 * Answers of the retired token and redraft (free-swap / trade) endpoints (draft-backend §8.1 #29–#31). Server only.
 * The body is the draft error contract: the English catalog text plus its `errors/draft` code.
 */
import 'server-only';

import { NextResponse } from 'next/server';
import { DRAFT_ERROR_STATUS, draftErrorMessage } from '@/lib/draft/errors';
import type { DraftApiErrorBody } from '@/types/draft-queue';

type RetiredCode = 'ENDPOINT_REPLACED' | 'REDRAFT_TRADE_RETIRED';

/** `410` with the code; writes and reads nothing. */
export function retiredResponse(code: RetiredCode): NextResponse<DraftApiErrorBody> {
  return NextResponse.json<DraftApiErrorBody>(
    { success: false, error: draftErrorMessage(code), code },
    { status: DRAFT_ERROR_STATUS[code] },
  );
}
