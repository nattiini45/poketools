# Avatar Module

## Overview
The Avatar module handles layered trainer avatar rendering, AI-assisted generation, manifest validation, and gallery workflows.

## File Structure
```
src/lib/avatar/
├── manifest-data.json  # Avatar option data
├── manifest.ts  # Manifest read/validation/defaults
├── consent.ts  # Consent helpers
├── nanogpt.ts  # AI image generation request
├── preloader.ts  # Client asset preloading helpers
├── prompt-template.ts  # AI prompt shaping
├── rate-limit.ts  # Generation rate-limit checks
├── renderer.ts  # Layer composition rendering
├── showdown-trainers.json  # Showdown trainer presets
└── transform.ts  # Image transform helpers
```

## Core Functions/Classes

### Avatar Renderer
- **File**: `renderer.ts`
- **Purpose**: Render configured avatar layers
- **Key Methods**: `renderAvatar()`, `compositeToBlob()`, `compositeToBase64()`

### AI Avatar Generation
- **File**: `nanogpt.ts`
- **Purpose**: Trigger AI image generation for avatars
- **Key Methods**: `generateImage()`

### Manifest + Validation
- **File**: `manifest.ts`
- **Purpose**: Resolve options/defaults and validate config
- **Key Methods**: `getCategories()`, `getDefaultAvatarConfig()`, `validateAvatarConfig()`

### Rate Limiting
- **File**: `rate-limit.ts`
- **Purpose**: Enforce generation quota
- **Key Methods**: `checkAndRecordGeneration()`, `checkGenerationLimit()`

## Data Flows
- **Input**: Avatar config or AI generation request
- **Processing**:
  1. Validate config against manifest
  2. Render composite image or call generation provider
  3. Persist/retrieve gallery records via API routes
- **Output**: Rendered/avatar image payloads and gallery entries

## Builder UI and save locking
`src/components/avatar/AvatarBuilder.tsx` hosts four modes: Build (layer builder), Trainer Sprites (`ShowdownPicker`), Generate with AI (`AiAvatarGenerator`) and Photo Transform (`PhotoTransformPanel`). Every save or removal POSTs (or DELETEs) `/api/players/[id]/avatar` and then awaits the page's `onSaved` follow-up (session refresh, then navigation).

- **Single-flight saves**: one save runs at a time across the whole builder. The Build panel's Save and Remove claim a token from a ref before they start (synchronously, not on the next render) and return without a request while any save is in flight. Only the save that owns the token releases it, so a stale completion can never unlock the buttons while a later save is running.
- **Sibling panels** report each save's start and end through `onBusyChange(true/false)`. The builder counts them in state, for the disabled tabs, and in a ref, for the synchronous check. The mode tabs stay locked until every reported save (the POST and the awaited `onSaved`) has finished. A tab click in the same tick as a save's start is ignored, not just disabled on the next render.
- Tests: `src/components/avatar/__tests__/AvatarBuilder.onSaved.test.tsx`.

## Dependencies
- **External Libraries**: Browser canvas/image APIs
- **Internal Modules**:
  - [Supabase Module](./supabase.md) - avatar gallery persistence
  - [AI Module](./ai.md) - model-backed generation path

## API Routes
- `/api/avatar/manifest`
- `/api/avatar/generate`
- `/api/avatar/transform`
- `/api/avatar/gallery`
- `/api/avatar/gallery/[id]`

## Usage Examples

```typescript
import { renderAvatar } from '@/lib/avatar/renderer';

const dataUrl = await renderAvatar(config, { output: 'data-url' });
```

## Testing
- **Test Files**: `src/components/avatar/__tests__/AvatarBuilder.onSaved.test.tsx` (awaited `onSaved`, single-flight saves, tab lock), `src/components/avatar/__tests__/AiAvatarGenerator.test.tsx`
- **Testing Approach**: Component handlers driven without a renderer (hooks mocked), plus route/UI integration coverage

## Related Modules
- [AI Module](./ai.md)
- [Supabase Module](./supabase.md)
