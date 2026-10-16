# Auth Module

## Overview
The Auth module handles authentication and authorization with NextAuth v5 and shared helper guards for API routes.

## File Structure
```
src/
├── auth.ts  # NextAuth config and exported handlers/auth/signIn/signOut
└── lib/auth/
    └── helpers.ts  # Session + role/resource guard helpers
```

## Core Functions/Classes

### NextAuth Config
- **File**: `src/auth.ts`
- **Purpose**: Central NextAuth v5 setup
- **Key Methods**: `handlers`, `auth`, `signIn`, `signOut`

### Session Helpers
- **File**: `helpers.ts`
- **Purpose**: Session access for server code
- **Key Methods**: `getSession()`, `getSessionPlayer()`

### Guard Helpers
- **File**: `helpers.ts`
- **Purpose**: Route authorization gates
- **Key Methods**: `requireAuth()`, `requirePlayer()`, `requireAdmin()`, `requireAnyAdmin()`, `requireResourceAdmin()`, `requireDraftAdmin()`, `requireCreator()`

## Data Flows
- **Input**: Request cookies/session tokens
- **Processing**:
  1. Resolve session via `auth()`
  2. Attach `session.player` metadata
  3. Apply role/resource checks in guards
- **Output**: Session/player context or `AuthError`

## Dependencies
- **External Libraries**: `next-auth`
- **Internal Modules**:
  - [Supabase Module](./supabase.md) - player/resource-admin lookups

## API Routes
- `/api/auth/[...nextauth]`

## Usage Examples

```typescript
import { requireAdmin } from '@/lib/auth/helpers';

export async function GET() {
  await requireAdmin();
  return Response.json({ success: true });
}
```

## Testing
- **Test Files**: No dedicated auth unit test file currently
- **Testing Approach**: Integration tests through guarded API routes

## Related Modules
- [Supabase Module](./supabase.md)
