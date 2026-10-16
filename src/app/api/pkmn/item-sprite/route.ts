import { NextRequest, NextResponse } from 'next/server';
import { Icons } from '@pkmn/img';
import { safeErrorResponse } from '@/lib/api/error-response';

export async function GET(request: NextRequest) {
  try {
    const item = request.nextUrl.searchParams.get('item');
    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing item parameter',
          code: 'validation_failed',
          params: { issues: 'Missing item parameter' },
        },
        { status: 400 },
      );
    }

    const icon = Icons.getItem(item);

    return NextResponse.json({
      success: true,
      data: {
        top: icon.top,
        left: icon.left,
        url: icon.url,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch item sprite');
  }
}
