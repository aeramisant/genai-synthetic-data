import dotenv from 'dotenv';
// Primary load (uses current working directory). If server started from inside
// the server folder this will pick up server/.env automatically.
dotenv.config();
// Fallback: if key vars are still missing (e.g. process started from repo root),
// attempt to load the .env file that sits alongside this source file.
if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = new URL('../.env', import.meta.url).pathname;
    const alt = dotenv.config({ path: envPath });
    if (alt.error) {
      // non-fatal; just log once
      console.warn('Fallback .env load failed:', alt.error.message);
    } else if (alt.parsed) {
      console.log('Loaded environment from server/.env (fallback)');
    }
  } catch (e) {
    console.warn('Fallback .env resolution error:', e.message);
  }
}

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { setupDatabase } from './lib/database.js';
import { initializeLangfuse } from './lib/monitoring.js';
import DataGenerator from './lib/dataGenerator.js';
import DatasetManager from './lib/datasetManager.js';
import ChatService from './lib/chatService.js';
import {
  generateDeterministicData,
  validateDeterministicData,
} from './lib/deterministicGenerator.js';
import GenerationService, { getJob } from './lib/generationService.js';
import { CONFIG } from './lib/config.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataGenerator = new DataGenerator();
const datasetManager = new DatasetManager();
const generationService = new GenerationService();
const chatService = new ChatService();

// Simple in-memory concurrency cap
const MAX_CONCURRENT_GENERATIONS = Number(
  process.env.MAX_CONCURRENT_GENERATIONS || 3
);
let activeGenerations = 0;

// In-memory socket job subscription registry
const jobSubscribers = new Map(); // jobId -> Set<socket>
const jobWatchers = new Map(); // jobId -> timeout handle

function removeSocketFromAllJobs(socket) {
  for (const [jobId, set] of jobSubscribers.entries()) {
    if (set.has(socket)) {
      set.delete(socket);
      if (set.size === 0) jobSubscribers.delete(jobId);
    }
  }
}

function emitToJob(jobId, event, payload) {
  const subs = jobSubscribers.get(jobId);
  if (!subs) return;
  for (const sock of subs) {
    try {
      sock.emit(event, { jobId, ...payload });
    } catch (_) {
      /* ignore emit errors */
    }
  }
}

function monitorJobLifecycle(jobId) {
  if (jobWatchers.has(jobId)) return; // already watching
  const tick = () => {
    const job = getJob(jobId);
    if (!job) {
      jobWatchers.delete(jobId);
      return;
    }
    emitToJob(jobId, 'job:status', {
      status: job.status,
      progress: job.progress,
      error: job.error,
    });
    if (['completed', 'error', 'cancelled'].includes(job.status)) {
      emitToJob(jobId, 'job:completed', {
        status: job.status,
        result: job.result
          ? {
              datasetId: job.result.datasetId,
              rowCounts: job.result.rowCounts,
              validation: job.result.validation,
              temperature: job.result.meta?.temperature,
              aiErrors: job.result.meta?.aiErrors,
              normalized: job.result.meta?.normalized,
            }
          : null,
        error: job.error,
      });
      jobWatchers.delete(jobId);
      return;
    }
    // reschedule
    const handle = setTimeout(tick, 700);
    jobWatchers.set(jobId, handle);
  };
  tick();
}

function buildSocketServer(server) {
  const io = new SocketIOServer(server, {
    cors: {
      origin:
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3000'
          : 'https://your-production-domain.com',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log('New client connected');

    // Job subscription management -------------------------------------------------
    socket.on('subscribe:job', ({ jobId } = {}) => {
      if (!jobId) return socket.emit('job:error', { error: 'jobId required' });
      if (!jobSubscribers.has(jobId)) jobSubscribers.set(jobId, new Set());
      jobSubscribers.get(jobId).add(socket);
      socket.emit('job:subscribed', { jobId });
      const job = getJob(jobId);
      if (job) {
        socket.emit('job:status', {
          jobId,
          status: job.status,
          progress: job.progress,
          error: job.error,
        });
        if (['completed', 'error', 'cancelled'].includes(job.status)) {
          socket.emit('job:completed', {
            jobId,
            status: job.status,
            result: job.result
              ? {
                  datasetId: job.result.datasetId,
                  rowCounts: job.result.rowCounts,
                  validation: job.result.validation,
                  temperature: job.result.meta?.temperature,
                  aiErrors: job.result.meta?.aiErrors,
                  normalized: job.result.meta?.normalized,
                }
              : null,
            error: job.error,
          });
        } else {
          monitorJobLifecycle(jobId);
        }
      } else {
        // monitor in case job appears shortly after (race window)
        monitorJobLifecycle(jobId);
      }
    });

    socket.on('unsubscribe:job', ({ jobId } = {}) => {
      if (!jobId) return;
      const subs = jobSubscribers.get(jobId);
      if (subs) {
        subs.delete(socket);
        if (subs.size === 0) jobSubscribers.delete(jobId);
      }
      socket.emit('job:unsubscribed', { jobId });
    });

    socket.on('generateData', async (payload = {}) => {
      const startTs = Date.now();
      const {
        ddl = '',
        instructions = '',
        config = {},
        saveName = null,
        description = null,
      } = payload;
      try {
        socket.emit('generation:start', {
          message: 'Starting generation',
          config,
        });
        // 1. Parse schema
        const schema = await dataGenerator.parseDDL(ddl);
        socket.emit('schema:parsed', {
          tables: Object.keys(schema.tables),
          tableCount: Object.keys(schema.tables).length,
        });

        // 2. Prepare deterministic baseline for referential integrity
        const baseline = generateDeterministicData(schema, {
          globalRowCount: config.numRecords || 100,
          perTable: config.perTableRowCounts || {},
          nullProbability: config.nullProbability || {},
          seed: config.seed,
          debug: config.debug,
          withMeta: true,
        });
        const finalData = {};
        const useAI = process.env.USE_AI !== 'false';
        const tables = baseline.meta?.order?.length
          ? baseline.meta.order
          : Object.keys(schema.tables);

        // Helper to emit rows in chunks to simulate streaming
        const emitTableDataChunks = async (tableName, rows) => {
          const chunkSize = Math.max(1, Math.min(50, config.chunkSize || 25));
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            socket.emit('table:progress', {
              table: tableName,
              delivered: Math.min(i + chunk.length, rows.length),
              total: rows.length,
              chunk,
            });
            // Allow event loop to breathe
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 5));
          }
        };

        for (const tableName of tables) {
          socket.emit('table:start', { table: tableName });
          let rows = baseline.data
            ? baseline.data[tableName]
            : baseline[tableName];
          if (useAI) {
            try {
              // Reuse internal per-table AI approach from DataGenerator (simplified inline)
              const tableSchema = schema.tables[tableName];
              const targetCount =
                config.perTableRowCounts?.[tableName] ||
                config.numRecords ||
                100;
              const prompt = `Generate synthetic data for the ${tableName} table. Generate ${targetCount} records while maintaining referential integrity. Table Schema: ${JSON.stringify(
                tableSchema,
                null,
                2
              )} Full Schema Context: ${JSON.stringify(
                schema,
                null,
                2
              )} Additional Instructions: ${
                instructions || 'Generate realistic and consistent data'
              } Return ONLY a JSON array of records for the ${tableName} table. IMPORTANT: Return only the JSON array without any markdown formatting or code blocks.`;
              const result = await dataGenerator.model.generateContent(prompt);
              const rawText = result.response.text();
              // Lightweight cleanup relying on existing helper (import not available directly here). Fallback parse attempt.
              let cleaned = rawText.trim();
              cleaned = cleaned
                .replace(/```[a-zA-Z]*\n?/g, '')
                .replace(/```/g, '')
                .trim();
              if (!cleaned.startsWith('[')) {
                const first = cleaned.indexOf('[');
                if (first >= 0) cleaned = cleaned.slice(first);
              }
              const last = cleaned.lastIndexOf(']');
              if (last > 0) cleaned = cleaned.slice(0, last + 1);
              let aiRows = [];
              try {
                aiRows = JSON.parse(cleaned);
              } catch {
                aiRows = [];
              }
              if (Array.isArray(aiRows) && aiRows.length) {
                rows = aiRows;
              }
            } catch (aiErr) {
              socket.emit('table:ai_fallback', {
                table: tableName,
                error: aiErr.message,
              });
            }
          }
          finalData[tableName] = rows;
          await emitTableDataChunks(tableName, rows);
          socket.emit('table:complete', {
            table: tableName,
            rows: rows.length,
          });
        }

        // 3. Validate
        const validation = validateDeterministicData(schema, finalData, {
          debug: config.debug,
        });
        socket.emit('generation:validation', validation.report || validation);

        // 4. Persist if requested
        let datasetId = null;
        if (saveName) {
          try {
            datasetId = await datasetManager.saveDataset(
              saveName,
              description || 'Streaming generated dataset',
              schema,
              finalData,
              { seed: config.seed, validation: validation.report || validation }
            );
            socket.emit('dataset:saved', { datasetId });
          } catch (persistErr) {
            socket.emit('dataset:save_error', { error: persistErr.message });
          }
        }

        const durationMs = Date.now() - startTs;
        socket.emit('generation:complete', {
          tables: tables.length,
          durationMs,
          datasetId,
        });
      } catch (error) {
        socket.emit('generation:error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
      removeSocketFromAllJobs(socket);
    });
  });
  return io;
}

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    if (ext !== '.sql' && ext !== '.ddl' && ext !== '.txt') {
      return cb(new Error('Only SQL, DDL, and TXT files are allowed'));
    }
    cb(null, true);
  },
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

// Rate limiting (focus on heavy endpoints)
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Try again shortly.' },
});

// Initialize services (don't block server start; log failures)
setupDatabase().catch((e) => {
  console.error('Database initialization failed:', e.message);
});
try {
  initializeLangfuse();
} catch (e) {
  console.warn('Langfuse not initialized:', e.message);
}

// Deferred Socket.IO initialization happens in startServer()

// API Routes
app.post('/api/upload', upload.single('schema'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Handle the uploaded file
  // Optionally parse schema if requested via query param parse=true
  if (req.query.parse === 'true') {
    // Read file
    import('fs').then(async (fsMod) => {
      const ddl = await fsMod.promises.readFile(req.file.path, 'utf-8');
      try {
        const schema = await generationService.parseDDL(ddl);
        res.json({ message: 'File uploaded successfully', schema });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });
  } else {
    res.json({ message: 'File uploaded successfully' });
  }
});

app.post('/api/generate', heavyLimiter, async (req, res, next) => {
  try {
    if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
      return res.status(429).json({ error: 'Too many concurrent generations' });
    }
    const {
      ddl,
      instructions,
      config = {},
      saveName,
      description,
    } = req.body || {};
    if (!ddl || typeof ddl !== 'string') {
      return res.status(400).json({ error: 'ddl string required' });
    }
    if (ddl.length > 200000) {
      return res.status(400).json({ error: 'DDL too large (200k char limit)' });
    }
    if (instructions && instructions.length > 5000) {
      return res
        .status(400)
        .json({ error: 'instructions too long (5k char limit)' });
    }
    const maxRows = Number(process.env.MAX_ROWS_PER_TABLE || 5000);
    if (config.numRecords && config.numRecords > maxRows) {
      return res
        .status(400)
        .json({ error: `numRecords exceeds max ${maxRows}` });
    }
    // Temperature support: attach to config for model usage
    const temperature = Number(config.temperature);
    if (!Number.isNaN(temperature)) {
      process.env.MODEL_TEMPERATURE = String(
        Math.min(Math.max(temperature, 0), 1)
      );
    }
    activeGenerations += 1;
    try {
      // We capture jobId post-call; callbacks close over mutable ref.
      let jobIdRef = null;
      const callbacks = {
        onTableStart: ({ table, index, total }) => {
          if (!jobIdRef) return; // not yet assigned
          emitToJob(jobIdRef, 'job:tableStart', { table, index, total });
        },
        onTableComplete: ({ table, index, total, rows }) => {
          if (!jobIdRef) return;
          emitToJob(jobIdRef, 'job:tableComplete', {
            table,
            index,
            total,
            rows,
          });
        },
        onProgress: ({ phase, completed, total, ratio }) => {
          if (!jobIdRef) return;
          // Update job.progress using heuristic mapping (0.1 -> 0.9 window)
          const job = getJob(jobIdRef);
          if (job && job.status === 'running') {
            const scaled = 0.1 + 0.7 * ratio; // leave headroom for validation/persist
            if (scaled > job.progress) job.progress = scaled;
          }
          emitToJob(jobIdRef, 'job:progress', {
            phase,
            completed,
            total,
            ratio,
            progress: getJob(jobIdRef)?.progress,
          });
        },
      };
      const asyncJob = generationService.generateAsync({
        ddl,
        instructions,
        config,
        saveName,
        description,
        callbacks,
      });
      jobIdRef = asyncJob.jobId; // assign after call; setImmediate ensures safety
      monitorJobLifecycle(jobIdRef); // ensure lifecycle events even if no subscriber yet
      res.json(asyncJob); // returns jobId immediately
    } finally {
      activeGenerations = Math.max(0, activeGenerations - 1);
    }
  } catch (e) {
    next(e);
  }
});

// Lightweight job status polling endpoint
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // Do not leak full result data if large; return summary
  const { id, kind, status, progress, phase, error, createdAt, result } = job;
  res.json({
    id,
    kind,
    status,
    progress,
    phase,
    error,
    createdAt,
    // Provide minimal result metadata if completed
    result: result
      ? {
          datasetId: result.datasetId,
          validation: result.validation?.summary || result.validation,
          rowCounts: result.rowCounts,
          temperature: result.meta?.temperature,
          aiErrors: result.meta?.aiErrors,
          normalized: result.meta?.normalized,
          normalizationError: result.meta?.normalizationError,
        }
      : null,
  });
});

app.get('/api/datasets', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const rows = await generationService.listDatasets({ limit, offset });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Specific 'latest' route must come before numeric id route
app.get('/api/datasets/latest', async (req, res, next) => {
  try {
    const includeData = req.query.includeData === 'true';
    const ds = await generationService.getLatestDataset({ includeData });
    if (!ds.meta && ds.metadata?.generation_meta) {
      ds.meta = ds.metadata.generation_meta;
    }
    res.json(ds);
  } catch (e) {
    next(e);
  }
});

// Constrain id param to digits only so 'latest' won't match here
app.get('/api/datasets/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const includeData = req.query.includeData === 'true';
    const ds = await generationService.getDataset(id, { includeData });
    if (!ds.meta && ds.metadata?.generation_meta) {
      ds.meta = ds.metadata.generation_meta;
    }
    res.json(ds);
  } catch (e) {
    next(e);
  }
});

// Table slice pagination for large datasets
app.get('/api/datasets/:id(\\d+)/table/:tableName', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tableName = req.params.tableName;
    const offset = parseInt(req.query.offset || '0', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const slice = await generationService.getDatasetTableSlice(id, tableName, {
      offset,
      limit,
    });
    res.json(slice);
  } catch (e) {
    if (/not found/i.test(e.message))
      return res.status(404).json({ error: e.message });
    next(e);
  }
});

app.get('/api/datasets/:id/export', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { zipPath } = await generationService.exportDataset(id);
    res.download(zipPath);
  } catch (e) {
    next(e);
  }
});

app.delete('/api/datasets/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await generationService.deleteDataset(id);
    res.json(r);
  } catch (e) {
    if (/not found/i.test(e.message))
      return res.status(404).json({ error: e.message });
    next(e);
  }
});

app.post('/api/datasets/:id/modify', heavyLimiter, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { prompt, tableName } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (prompt.length > 5000)
      return res.status(400).json({ error: 'prompt too long (5k char limit)' });
    const result = await generationService.modifyDataset(id, {
      prompt,
      tableName,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.get('/api/health', async (_req, res, next) => {
  try {
    const h = await generationService.health();
    res.json(h);
  } catch (e) {
    next(e);
  }
});

// Test Gemini's DDL understanding
app.post('/api/test-ddl', async (req, res, next) => {
  try {
    const { ddl } = req.body;
    if (!ddl) {
      return res.status(400).json({ error: 'DDL required' });
    }
    const understanding = await chatService.testDDLUnderstanding(ddl);
    res.json({ understanding });
  } catch (err) {
    next(err);
  }
});

// Test data generation for a specific table
app.post('/api/test-data', async (req, res, next) => {
  try {
    const { ddl, tableName, count } = req.body;
    if (!ddl || !tableName) {
      return res.status(400).json({ error: 'DDL and tableName required' });
    }
    // First parse the schema
    const schema = await dataGenerator.parseDDL(ddl);
    if (!schema.tables[tableName]) {
      return res
        .status(404)
        .json({ error: `Table ${tableName} not found in schema` });
    }
    // Generate test data for the table
    const result = await chatService.testDataGeneration(
      schema,
      tableName,
      count
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// UI configuration / limits endpoint
app.get('/api/config', (_req, res) => {
  res.json({
    maxRowsPerTable: CONFIG.MAX_ROWS_PER_TABLE,
    defaultNumRecords: CONFIG.DEFAULT_NUM_RECORDS,
    aiEnabled: process.env.USE_AI !== 'false',
    model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    configurableRows: false,
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const response = await chatService.generateResponse(message);
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve React app
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Fallback + error handling
app.use(notFound);
app.use(errorHandler);

let activeServer; // track for graceful shutdown

function startServer(port, retries = 5) {
  const server = http.createServer(app);

  // Job cancellation endpoint
  app.delete('/api/jobs/:id/cancel', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (['completed', 'error', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: 'Job not cancellable' });
    }
    const ok = generationService.cancelJob(req.params.id);
    if (!ok) return res.status(400).json({ error: 'Unable to cancel' });
    res.json({ status: 'cancelling' });
  });
  // Attach error handler first to capture immediate EADDRINUSE
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (retries > 0) {
        const nextPort = Number(port) + 1;
        console.warn(
          `Port ${port} in use. Retrying on port ${nextPort} (remaining retries: ${retries})`
        );
        setTimeout(() => startServer(nextPort, retries - 1), 400);
      } else {
        console.error(
          `All retry attempts failed. Last port attempted: ${port}. You can set PORT to a free port.`
        );
        console.error(
          'To find process using the port on macOS: lsof -i :' + port
        );
      }
    } else {
      console.error('Server error:', err);
    }
  });
  buildSocketServer(server); // attach socket handlers
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  activeServer = server;
  return server;
}

const initialPort = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  startServer(initialPort);
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
      console.log('HTTP server closed');
    }
    // Close PG pool lazily imported (avoids circular import here)
    const { pool } = await import('./lib/database.js');
    await pool.end();
    console.log('Database pool closed');
  } catch (err) {
    console.error('Error during shutdown:', err.message);
  } finally {
    process.exit(0);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => gracefulShutdown(sig));
});

export { app, startServer };
