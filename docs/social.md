# Social Module

## Overview
The Social module handles event fan-out to X, Threads, and Bluesky with provider-specific publishing and formatting.

## File Structure
```
src/lib/social/
├── crypto.ts  # Credential encryption/decryption helpers
├── format.ts  # Event -> social post formatter
├── image-fetch.ts  # Remote image fetching helpers
├── notify.ts  # Event fan-out orchestration
├── validation.ts  # Social integration input validation
└── providers/
    ├── bluesky.ts  # Bluesky publishing
    ├── index.ts  # Provider dispatcher
    ├── threads.ts  # Threads publishing
    └── x.ts  # X publishing
```

## Core Functions/Classes

### Event Fan-Out
- **File**: `notify.ts`
- **Purpose**: Fire-and-forget publish for configured integrations
- **Key Methods**: `emitSocialEvent()`, `sendSocialTestMessage()`

### Provider Dispatcher
- **File**: `providers/index.ts`
- **Purpose**: Route a publish call to the provider implementation
- **Key Methods**: `publishToProvider()`

### Formatter
- **File**: `format.ts`
- **Purpose**: Build provider-safe social post text
- **Key Methods**: `formatSocialPost()`

## Data Flows
- **Input**: Social event payload + provider credentials/options
- **Processing**:
  1. Resolve scoped integrations
  2. Decrypt credentials and format content
  3. Publish to each target provider
- **Output**: Published social posts (errors are logged and swallowed)

## Dependencies
- **External Libraries**: Provider HTTP APIs
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Tournament Module](./tournament.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/social-integrations`
- `/api/social-integrations/[id]`
- `/api/social-integrations/[id]/test`

## Usage Examples

```typescript
import { emitSocialEvent } from '@/lib/social/notify';

void emitSocialEvent(payload);
```

## Testing
- **Test Files**:
  - `src/app/api/social-integrations/__tests__/route.test.ts`
  - `src/app/api/social-integrations/[id]/__tests__/route.test.ts`
- **Testing Approach**: API route coverage with mocked provider calls

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
