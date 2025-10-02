# API Reference

Comprehensive reference for REST endpoints and Socket.IO events.

## Conventions

- All responses are JSON unless downloading a file.
- Errors use shape: `{ "error": { "message": string, "code": string } }`.
- Timestamps are ISO 8601 (UTC).
- `datasetId` is an integer primary key.

## REST Endpoints

### POST /api/generate

Generate synthetic data from DDL and optionally persist.

Request body:

```json
{
  "ddl": "CREATE TABLE authors(id INT PRIMARY KEY, name TEXT);",
  "instructions": "Diverse author names",
  "config": {
    "numRecords": 50,
    "perTableRowCounts": { "authors": 25 },
    "seed": 42,
    "temperature": 0.25,
    "withMeta": true
  },
  "saveName": "authors_run",
  "description": "Initial authors dataset"
}
```

Response:

```json
{
  "datasetId": 12,
  "meta": {
    "seed": 42,
    "order": ["authors"],
    "validation": {
      "summary": {
        "pkDuplicates": 0,
        "fkViolations": 0,
        "notNullViolations": 0
      },
      "tables": {
        "authors": {
          /* ... */
        }
      }
    }
  },
  "validation": {
    "summary": {
      /* same as meta.validation.summary */
    }
  },
  "rowCounts": { "authors": 25 }
}
```

Errors:

- 400: missing ddl or invalid JSON.

### GET /api/datasets

List datasets.

Query params: `limit` (default 50, max 200), `offset` (default 0)

Response example:

```json
[
  {
    "id": 12,
    "name": "authors_run",
    "description": "Initial authors dataset",
    "created_at": "2025-09-30T12:00:00Z",
    "rowCounts": { "authors": 25 }
  }
]
```

### GET /api/datasets/:id

Retrieve metadata and optionally data.

Query params: `includeData=true` to embed table rows.

Response (metadata only):

```json
{
  "metadata": {
    "id": 12,
    "name": "authors_run",
    "description": "Initial authors dataset",
    "created_at": "2025-09-30T12:00:00Z",
    "generation_meta": {
      /* meta */
    }
  },
  "rowCounts": null
}
```

Response (with data):

```json
{
  "metadata": {
    /* as above */
  },
  "rowCounts": { "authors": 25 },
  "data": { "authors": [{ "id": 1, "name": "Alice" }] }
}
```

Errors:

- 404 if dataset not found.

### GET /api/datasets/:id/export

Downloads a ZIP containing one CSV per table.

- Content-Disposition set for file download.
- Errors: 404 if dataset not found.

### POST /api/datasets/:id/modify

Modify entire dataset or a single table using an AI prompt.

Request body:

```json
{ "prompt": "Append a suffix to every author name", "tableName": "authors" }
```

Response:

```json
{
  "datasetId": 12,
  "diff": { "authors": { "before": 25, "after": 25, "delta": 0 } },
  "validation": {
    "summary": { "pkDuplicates": 0, "fkViolations": 0, "notNullViolations": 0 }
  }
}
```

Errors:

- 400 missing prompt.
- 404 dataset not found.

### POST /api/upload?parse=true

Uploads a DDL file (multipart form field `schema`) and returns parsed schema when `parse=true`.

Response example:

```json
{
  "message": "File uploaded successfully",
  "schema": {
    "tables": {
      /* ... */
    }
  }
}
```

### GET /api/health

Health & migrations state.

```json
{ "db": "ok", "migrations": { "applied": 1, "latest": "0001_initial.sql" } }
```

### GET /api/jobs/:id

Poll a background job (currently only generation jobs). Although /api/generate responds synchronously with the final result today, the jobId is included to allow future asynchronous behavior.

Response example:

```json
{
  "id": "3b4e9c9c-...",
  "kind": "generate",
  "status": "completed",
  "progress": 1,
  "error": null,
  "createdAt": 1732999999999,
  "result": {
    "datasetId": 12,
    "validation": {
      "pkDuplicates": 0,
      "fkViolations": 0,
      "notNullViolations": 0
    },
    "rowCounts": { "authors": 25 }
  }
}
```

Statuses: created | running | completed | error.

## Socket.IO Events (Namespace: default)

Event: `generateData` (client → server)

Payload:

```json
{
  "ddl": "CREATE TABLE ...",
  "instructions": "...",
  "config": { "numRecords": 100, "seed": 7, "chunkSize": 30 },
  "saveName": "run_1",
  "description": "Streaming test"
}
```

Server Emissions:

- `generation:start` `{ message, config }`
- `schema:parsed` `{ tables: [..], tableCount }`
- `table:start` `{ table }`
- `table:progress` `{ table, delivered, total, chunk: [ {...} ] }`
- `table:ai_fallback` `{ table, error }`
- `table:complete` `{ table, rows }`
- `generation:validation` `{ summary, tables }`
- `dataset:saved` `{ datasetId }`
- `generation:complete` `{ tables: count, durationMs, datasetId }`
- `generation:error` `{ message }`

## Error Object

```json
{ "error": { "message": "Not Found", "code": "NOT_FOUND" } }
```

## Temperature Handling

- Pass in `config.temperature` (0–1). Backend stores it in `MODEL_TEMPERATURE` env for current process request and applies to Gemini `generationConfig.temperature`.
- If omitted, model default is used.

## Seeds & Reproducibility

- Provide `config.seed` to reproduce deterministic baseline.
- Validation report stored in `generation_meta`.

## Future Extensions (Planned)

- Domain value plugins.
- Dataset diff endpoint.
- SSE fallback for progress.

---

For questions or issues, open a ticket or extend the docs here.
