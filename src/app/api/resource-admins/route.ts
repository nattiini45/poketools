import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resourceAdminCreateSchema, resourceAdminDeleteSchema, formatZodErrors } from '@/lib/validation';
import {
  getResourceAdmins,
  addResourceAdmin,
  removeResourceAdmin,
} from '@/lib/supabase/queries/resource-admins';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { ResourceAdminWithPlayer } from '@/types/resource-admin';

/** List resource admins for a specific resource. Site-admin only. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const resourceType = searchParams.get('resource_type');
    const resourceId = searchParams.get('resource_id');

    if (!resourceType || !resourceId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'resource_type and resource_id are required', code: 'resource_admin_target_required' },
        { status: 400 }
      );
    }

    const zodResult = resourceAdminCreateSchema.pick({ resource_type: true, resource_id: true }).safeParse({ resource_type: resourceType, resource_id: resourceId });
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const admins = await getResourceAdmins(zodResult.data.resource_type, zodResult.data.resource_id);
    return NextResponse.json<ApiResult<ResourceAdminWithPlayer[]>>({
      success: true,
      data: admins,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch resource admins');
  }
}

/** Assign a player as resource admin. Site-admin only. */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const rawBody = await request.json();
    const zodResult = resourceAdminCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await addResourceAdmin(zodResult.data.player_id, zodResult.data.resource_type, zodResult.data.resource_id);
    logAuditEvent({
      action: 'resource_admin.grant',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: zodResult.data.resource_type,
      resource_id: zodResult.data.resource_id,
      metadata: { target_player_id: zodResult.data.player_id },
    });
    return NextResponse.json<ApiResult<typeof result>>(
      { success: true, data: result },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to assign resource admin');
  }
}

/** Remove a resource admin assignment. Site-admin only. */
export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const rawBody = await request.json();
    const zodResult = resourceAdminDeleteSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await removeResourceAdmin(zodResult.data.player_id, zodResult.data.resource_type, zodResult.data.resource_id);
    logAuditEvent({
      action: 'resource_admin.revoke',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: zodResult.data.resource_type,
      resource_id: zodResult.data.resource_id,
      metadata: { target_player_id: zodResult.data.player_id },
    });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove resource admin');
  }
}