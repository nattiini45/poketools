# Smogon Module

## Overview
The Smogon module imports usage stats and sample sets from external Pokémon data sources into local cache tables.

## File Structure
```
src/lib/smogon/
├── format-registry.ts  # Importable format catalog
├── import-sets.ts  # Sample set + analysis importer
└── import-stats.ts  # Usage stats importer
```

## Core Functions/Classes

### Set Importer
- **File**: `import-sets.ts`
- **Purpose**: Import generation-scoped sample sets
- **Key Methods**: `importGenerationSets()`, `importAllSets()`

### Stats Importer
- **File**: `import-stats.ts`
- **Purpose**: Import format usage stats
- **Key Methods**: `importFormatStats()`, `importAllStats()`

### Format Registry
- **File**: `format-registry.ts`
- **Purpose**: Resolve importable format list
- **Key Methods**: `fetchAvailableStatsFormats()`, `getImportableFormats()`

## Data Flows
- **Input**: Format/generation import targets
- **Processing**:
  1. Fetch remote JSON payloads
  2. Normalize to local schema
  3. Upsert batch rows into cache tables
- **Output**: Import result summaries and updated cache rows

## Dependencies
- **External Libraries**: `@pkmn/smogon`
- **Internal Modules**:
  - [PKMN Module](./pkmn.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/admin/import-stats`
- `/api/admin/import-usage-stats`
- `/api/admin/import-sets`
- `/api/admin/import-sample-sets`
- `/api/usage-stats`
- `/api/usage-stats/[pokemon]`
- `/api/usage-stats/formats`
- `/api/sample-sets`

## Usage Examples

```typescript
import { importFormatStats } from '@/lib/smogon/import-stats';

const result = await importFormatStats('gen9ou');
```

## Testing
- **Test Files**: No dedicated `src/lib/smogon/__tests__` file currently
- **Testing Approach**: Admin route + importer integration testing

## Related Modules
- [PKMN Module](./pkmn.md)
- [Supabase Module](./supabase.md)
