# Synthetic Data Generation Project

## Overview

This project implements a conversational AI application with two main functionalities:

1. Synthetic data generation
2. Natural language data querying

The project is divided into 3 phases, with Phase 1 focusing on data generation and Phases 2-3 on the conversational interface.

## Technical Stack

| Component        | Technology                           |
| ---------------- | ------------------------------------ |
| LLM              | Gemini 2.0 Flash (or newer)          |
| SDK              | Google GenAI SDK with Vertex AI Auth |
| Frontend         | React 19 + TypeScript + Vite         |
| Backend          | Node.js + Express                    |
| Real-time        | Socket.IO (WebSocket streaming)      |
| Database         | PostgreSQL                           |
| Containerization | Docker + Docker Compose              |
| Monitoring       | Langfuse for observability           |

> **Note**: The original spec suggested Streamlit or Gradio, but we chose **React + TypeScript** for better control, real-time streaming support via Socket.IO, and scalability for future phases.

### LLM Implementation Requirements

- ✅ Streaming (Socket.IO for real-time table chunk delivery)
- ✅ JSON/structured output (with cleanup and validation)
- 🔄 Function calling (basic JSON enforcement; can be enhanced with schema-based tool calling)

## Project Phases

### Phase 1: Synthetic Data Generation

#### Features

- Generate consistent and valid data for provided DDL schema (supports 5-7 Tables)
- Handle various data constraints:
  - Data types
  - Null values
  - Date and time formats
  - Primary and foreign keys
- Allow user modification through textual feedback
- Support data export (CSV/ZIP archive)
- Store generated data for access in 'Talk to your data' tab

#### Sample DDL Schemas

- [library_mgm.ddl](https://drive.google.com/file/d/1oUDt5kSDj2QBn_Aqo2LbnbD4Oq7F0uIM/view?usp=sharing)
- [restaurants.ddl](https://drive.google.com/file/d/1SCKz6v39lXlOnDnPWaLlaTGIaCo0xhyF/view?usp=sharing)
- [company_employee.ddl](https://drive.google.com/file/d/19M3fEiRdgoxtaqaPIFP_iOAGUI0UzS0Z/view?usp=sharing)

## UI Requirements

### Layout

- Sidebar with main tabs:
  - Data Generation
  - Talk to your data

### Data Generation Tab Features

1. File Upload
   - Support for DDL schema files (.sql, .txt, .ddl)
2. Text Input
   - Text box for data generation instructions (prompt)
3. Configuration
   - Additional generation parameters (e.g., temperature)
4. Generation Control
   - "Generate" button to trigger data generation
5. Data Preview
   - View generated data for each table
6. Data Modification
   - Text prompt input for table modifications
   - Submit button to apply changes

## Implementation Notes

- Use Gemini access instructions for SDK setup
- Follow SQL generation tips for Gemini
- Ensure proper data consistency and validation
- Implement robust error handling

---

### Deterministic Generation & Configuration

The generator supports two modes:

1. AI Hybrid (default) using Gemini with per-table prompts and deterministic fallback.
2. Deterministic only (`USE_AI=false`) for offline / reproducible runs.

Environment / runtime config keys:

| Key                 | Purpose                                              | Example                                |
| ------------------- | ---------------------------------------------------- | -------------------------------------- |
| `USE_AI`            | Enable/disable AI model usage                        | `USE_AI=false`                         |
| `DEBUG_DATA_GEN`    | Verbose stats + validation logs                      | `DEBUG_DATA_GEN=true`                  |
| `seed`              | Deterministic reproducibility                        | `{ seed: 123 }`                        |
| `numRecords`        | Global default rows per table                        | `{ numRecords: 50 }`                   |
| `perTableRowCounts` | Per-table overrides                                  | `{ perTableRowCounts: { Books: 120 }}` |
| `withMeta`          | Return `{ data, meta }` including validation summary | `{ withMeta: true }`                   |

Sample deterministic invocation:

```js
const data = await generator.generateSyntheticData(schema, '', {
  numRecords: 25,
  perTableRowCounts: { Authors: 10, Books: 40 },
  seed: 42,
  withMeta: true,
  debug: true,
});
```

`meta` includes: table order, inferred PKs, FK counts, per-column stats (null %, distinct count, samples), and validation report (PK duplicates, FK coverage %, NOT NULL violations).

### Migration System

Migrations reside in `migrations/` and are applied in lexicographic order. Applied filenames are stored in `schema_migrations`.

Check migrations:

```bash
npm run check:migrations
```

Expected output example:

```text
Migrations applied: 1
```

### Persisted Generation Metadata

When using `withMeta`, metadata (seed, order, validation) is stored in `generated_datasets.generation_meta`.

Query example:

```sql
SELECT id, generation_meta->>'seed' AS seed
FROM generated_datasets
ORDER BY id DESC
LIMIT 1;
```

---

## API Summary

This backend exposes REST + Socket.IO interfaces. Detailed request/response schemas live in `docs/API.md`.

### Core REST Endpoints

| Method | Path                       | Purpose                                                            |
| ------ | -------------------------- | ------------------------------------------------------------------ |
| POST   | `/api/generate`            | Generate & persist a dataset (returns datasetId, meta, validation) |
| GET    | `/api/datasets`            | List datasets with row counts                                      |
| GET    | `/api/datasets/:id`        | Retrieve dataset metadata (and data if `?includeData=true`)        |
| GET    | `/api/datasets/:id/export` | Download ZIP of CSVs                                               |
| POST   | `/api/datasets/:id/modify` | AI modify whole dataset or single table                            |
| POST   | `/api/upload?parse=true`   | Upload DDL and parse schema structure                              |
| GET    | `/api/health`              | DB & migrations status                                             |
| GET    | `/api/config`              | Basic UI limits & model info                                       |
| GET    | `/api/jobs/:id`            | Poll job status (generation progress)                              |

### Socket Events (Generation)

`generation:start`, `schema:parsed`, `table:start`, `table:progress`, `table:complete`, `generation:validation`, `dataset:saved`, `generation:complete`, `generation:error`.

See full payload contracts in `docs/API.md`.

### Configuration Endpoint

`GET /api/config` returns limits & flags for the UI to adapt without hardcoding:

```
{
   "maxRowsPerTable": 5000,
   "defaultNumRecords": 100,
   "aiEnabled": true,
   "model": "gemini-2.0-flash-001"
}
```

### CORS / Frontend Origin

Configure `NODE_ENV=development` to allow `http://localhost:3000` (frontend dev). Backend now defaults to port `4000` (was `5000`). For production set `PORT` or adjust the origin expression in `src/index.js`.

---

## Observability with Langfuse

Langfuse provides comprehensive observability for AI operations, tracking prompts, responses, errors, and performance metrics.

### Setup

1. **Get Langfuse credentials**:

   - Sign up at [https://cloud.langfuse.com](https://cloud.langfuse.com) (or self-host)
   - Obtain your `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`

2. **Configure environment** (`server/.env`):

   ```bash
   LANGFUSE_ENABLED=true
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_HOST=https://cloud.langfuse.com
   ```

3. **What gets tracked**:

   - Schema parsing (DDL input, table count, duration)
   - Per-table AI generation (prompts, responses, retries, errors)
   - Validation results (PK/FK violations, NOT NULL issues)
   - Dataset modifications (prompts, diffs, success/failure)

4. **Viewing traces**:
   - Navigate to your Langfuse dashboard
   - Find traces by `jobId` or `datasetId`
   - Review spans for each generation phase
   - Analyze errors, token usage, and latency

### Disabling Langfuse

Set `LANGFUSE_ENABLED=false` in your `.env` or omit the configuration entirely. The application will log a message and continue without observability.

---

## Environment Configuration

Copy `server/env.example.txt` to `server/.env` and fill in your credentials:

```bash
cp server/env.example.txt server/.env
```

Key variables:

- `GEMINI_API_KEY` (required for AI generation)
- `DATABASE_URL` (PostgreSQL connection string)
- `PORT` (default: 4000)
- `LANGFUSE_ENABLED`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (optional observability)

See `server/env.example.txt` for the full list of configurable options.
