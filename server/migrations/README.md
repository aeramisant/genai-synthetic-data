# Database Migrations

Migrations are applied in lexicographic (versioned) order using the `schema_migrations` table.

## Conventions

- Filename prefix: zero-padded incremental number (e.g., `0001_`, `0002_`).
- One logical change per file when possible.
- Idempotent patterns preferred (use `IF NOT EXISTS`).

## Current Migrations

- `0001_initial.sql`: Creates core tables (`generated_datasets`, `generated_data`) and index with `generation_meta` column.

## How it works

On startup `setupDatabase` will:

1. Ensure `schema_migrations` table exists.
2. Read the `migrations` directory.
3. Apply any migration whose filename is not yet recorded.
4. Record each applied filename.

Rollback support is not implemented yet (forward-only). For destructive changes create a new migration that transforms data safely.
