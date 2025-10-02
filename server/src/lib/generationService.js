import { v4 as uuidv4 } from 'uuid';
import DataGenerator from './dataGenerator.js';
import DatasetManager from './datasetManager.js';
import { validateDeterministicData } from './deterministicGenerator.js';
import DataModifier from './dataModifier.js';
import DataExporter from './dataExporter.js';
import { pool } from './database.js';
import { normalizeDataset } from './schemaNormalizer.js';

// Lightweight in-memory job store (could be replaced by Redis later)
const jobs = new Map();
const abortControllers = new Map();

function createJob(kind) {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    kind,
    status: 'created',
    progress: 0,
    error: null,
    result: null,
    createdAt: Date.now(),
    cancelled: false,
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export class GenerationService {
  constructor() {
    this.generator = new DataGenerator();
    this.datasetManager = new DatasetManager();
    this.exporter = new DataExporter();
    this.modifier = new DataModifier(this.generator);
  }

  async parseDDL(ddl) {
    return this.generator.parseDDL(ddl);
  }

  async _executeJob(
    job,
    { ddl, instructions, config, saveName, description, callbacks }
  ) {
    const controller = abortControllers.get(job.id);
    try {
      const schema = await this.parseDDL(ddl);
      job.progress = 0.1;
      const withMeta = true;
      const generationResult = await this.generator.generateSyntheticData(
        schema,
        instructions,
        {
          ...config,
          withMeta,
          abortSignal: controller?.signal,
          onTableStart: callbacks?.onTableStart,
          onTableComplete: callbacks?.onTableComplete,
          onProgress: callbacks?.onProgress,
        }
      );
      let data;
      let meta = {};
      if (generationResult?.data && generationResult?.meta) {
        data = generationResult.data;
        meta = generationResult.meta ?? {};
      } else {
        data = generationResult;
      }
      // Normalize AI generated data to align strictly with schema columns (drop extras, fill missing)
      try {
        if (meta.ai || (process.env.USE_AI !== 'false' && meta.ai !== false)) {
          data = normalizeDataset(schema, data);
          meta.normalized = true;
        }
      } catch (normErr) {
        // Record (non-fatal) normalization issue for visibility
        meta.normalizationError = normErr.message;
      }
      const validation = validateDeterministicData(schema, data, {
        debug: config?.debug,
      });
      meta = { ...meta, validation: validation.report };
      job.progress = 0.9;
      let datasetId = null;
      if (saveName) {
        datasetId = await this.datasetManager.saveDataset(
          saveName,
          description || 'Generated dataset',
          schema,
          data,
          meta
        );
      }
      job.status = 'completed';
      job.progress = 1;
      job.result = {
        jobId: job.id,
        datasetId,
        meta,
        validation: validation.report,
        rowCounts: Object.fromEntries(
          Object.entries(data).map(([t, rows]) => [t, rows.length])
        ),
      };
    } catch (err) {
      if (job.cancelled || /aborted/i.test(err.message)) {
        job.status = 'cancelled';
        job.error = 'Cancelled';
      } else {
        job.status = 'error';
        job.error = err.message;
      }
    } finally {
      abortControllers.delete(job.id);
    }
  }

  async generate(params) {
    const job = createJob('generate');
    job.status = 'running';
    abortControllers.set(job.id, new AbortController());
    await this._executeJob(job, params);
    if (job.result) return job.result;
    // throw if ended with error
    if (job.status === 'error')
      throw new Error(job.error || 'Generation failed');
    if (job.status === 'cancelled') throw new Error('Job cancelled');
    return { jobId: job.id, status: job.status };
  }

  generateAsync(params) {
    const job = createJob('generate');
    job.status = 'running';
    abortControllers.set(job.id, new AbortController());
    // Run in background
    setImmediate(() => this._executeJob(job, params));
    return { jobId: job.id, status: job.status };
  }

  async listDatasets({ limit = 50, offset = 0 } = {}) {
    const sql = `
      SELECT gd.id, gd.name, gd.description, gd.created_at,
             COALESCE(row_counts.rc, '{}') AS row_counts
      FROM generated_datasets gd
      LEFT JOIN (
        SELECT dataset_id, json_object_agg(table_name, row_count) AS rc
        FROM (
          SELECT dataset_id, table_name, COUNT(*)::int AS row_count
          FROM generated_data
          GROUP BY dataset_id, table_name
        ) q
        GROUP BY dataset_id
      ) row_counts ON row_counts.dataset_id = gd.id
      ORDER BY gd.created_at DESC
      LIMIT $1 OFFSET $2`;
    const res = await pool.query(sql, [limit, offset]);
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_at: r.created_at,
      rowCounts: r.row_counts || {},
    }));
  }

  async getDataset(datasetId, { includeData = true } = {}) {
    const metaRes = await pool.query(
      'SELECT * FROM generated_datasets WHERE id = $1',
      [datasetId]
    );
    if (!metaRes.rows.length) throw new Error('Dataset not found');
    const metaRow = metaRes.rows[0];
    let data = {};
    if (includeData) {
      const dataRes = await pool.query(
        'SELECT table_name, data FROM generated_data WHERE dataset_id = $1',
        [datasetId]
      );
      data = {};
      for (const row of dataRes.rows) {
        if (!data[row.table_name]) data[row.table_name] = [];
        data[row.table_name].push(row.data);
      }
    }
    // Derive row counts if data included else parse from generation_meta if present
    const rowCounts = includeData
      ? Object.fromEntries(
          Object.entries(data).map(([t, rows]) => [t, rows.length])
        )
      : null;
    const metadata = {
      id: metaRow.id,
      name: metaRow.name,
      description: metaRow.description,
      created_at: metaRow.created_at,
      generation_meta: metaRow.generation_meta,
    };
    // Backward compatible structure + new alias `meta` for easier client access
    return {
      metadata,
      meta: metadata.generation_meta || null,
      rowCounts,
      data: includeData ? data : undefined,
    };
  }

  async getLatestDataset({ includeData = false } = {}) {
    const res = await pool.query(
      'SELECT id FROM generated_datasets ORDER BY created_at DESC LIMIT 1'
    );
    if (!res.rows.length) throw new Error('No datasets found');
    return this.getDataset(res.rows[0].id, { includeData });
  }

  async getDatasetTableSlice(
    datasetId,
    tableName,
    { offset = 0, limit = 50 } = {}
  ) {
    // Basic bounds
    limit = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    offset = Math.max(parseInt(offset, 10) || 0, 0);
    // Ensure dataset exists (lightweight query)
    const ds = await pool.query(
      'SELECT id FROM generated_datasets WHERE id = $1',
      [datasetId]
    );
    if (!ds.rows.length) throw new Error('Dataset not found');
    // Total count
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS total FROM generated_data WHERE dataset_id = $1 AND table_name = $2',
      [datasetId, tableName]
    );
    const total = countRes.rows[0]?.total || 0;
    if (total === 0) {
      return { datasetId, table: tableName, offset, limit, total, rows: [] };
    }
    const rowsRes = await pool.query(
      'SELECT data FROM generated_data WHERE dataset_id = $1 AND table_name = $2 LIMIT $3 OFFSET $4',
      [datasetId, tableName, limit, offset]
    );
    const rows = rowsRes.rows.map((r) => r.data);
    return { datasetId, table: tableName, offset, limit, total, rows };
  }

  async exportDataset(datasetId) {
    const dataset = await this.getDataset(datasetId, { includeData: true });
    const zipPath = await this.exporter.createZipArchive(
      await this.exporter.exportToCSV(dataset.data),
      `dataset_${datasetId}`
    );
    return { zipPath };
  }

  async modifyDataset(datasetId, { prompt, tableName }) {
    // Load original dataset fully
    const original = await this.getDataset(datasetId, { includeData: true });
    const originalData = original.data;
    let targetData = originalData;
    if (tableName) {
      if (!originalData[tableName])
        throw new Error('Table not found in dataset');
      targetData = { [tableName]: originalData[tableName] };
    }

    const modified = await this.modifier.modifyData(targetData, prompt);

    // Merge back if table-specific
    const merged = tableName
      ? { ...originalData, [tableName]: modified[tableName] }
      : modified;

    // Simple diff summary
    const diff = {};
    Object.keys(merged).forEach((t) => {
      const beforeLen = originalData[t]?.length || 0;
      const afterLen = merged[t]?.length || 0;
      if (beforeLen !== afterLen) {
        diff[t] = {
          before: beforeLen,
          after: afterLen,
          delta: afterLen - beforeLen,
        };
      }
    });

    // Persist changes: remove old rows and insert new
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM generated_data WHERE dataset_id = $1', [
        datasetId,
      ]);
      for (const [t, rows] of Object.entries(merged)) {
        for (const row of rows) {
          await client.query(
            'INSERT INTO generated_data (dataset_id, table_name, data) VALUES ($1, $2, $3)',
            [datasetId, t, JSON.stringify(row)]
          );
        }
      }
      await client.query(
        'UPDATE generated_datasets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [datasetId]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Re-validate complete dataset
    // Need the schema; stored schema_definition field contains original
    const schemaDef =
      original.metadata.schema_definition ||
      original.metadata.generation_meta?.schema;
    // If schema not stored explicitly here, we trust structure from rows (skip validation)
    let validation = null;
    if (schemaDef) {
      try {
        validation = validateDeterministicData(schemaDef, merged, {});
      } catch {
        /* ignore */
      }
    }

    return { datasetId, diff, validation: validation?.report };
  }

  async health() {
    const mig = await pool.query(
      'SELECT COUNT(*)::int AS applied, MAX(filename) AS latest FROM schema_migrations'
    );
    return { db: 'ok', migrations: mig.rows[0] };
  }

  cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;
    if (['completed', 'error', 'cancelled'].includes(job.status)) return false;
    job.cancelled = true;
    job.status = 'cancelling';
    const controller = abortControllers.get(jobId);
    if (controller) controller.abort();
    return true;
  }
}

export default GenerationService;
export { jobs };
