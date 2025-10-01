import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDatabase } from './lib/database.js';
import { initializeLangfuse } from './lib/monitoring.js';
import DataGenerator from './lib/dataGenerator.js';
import DatasetManager from './lib/datasetManager.js';
import {
  generateDeterministicData,
  validateDeterministicData,
} from './lib/deterministicGenerator.js';
import GenerationService, { getJob } from './lib/generationService.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataGenerator = new DataGenerator();
const datasetManager = new DatasetManager();
const generationService = new GenerationService();

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

app.post('/api/generate', async (req, res, next) => {
  try {
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
    const result = await generationService.generate({
      ddl,
      instructions,
      config,
      saveName,
      description,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Lightweight job status polling endpoint
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // Do not leak full result data if large; return summary
  const { id, kind, status, progress, error, createdAt, result } = job;
  res.json({
    id,
    kind,
    status,
    progress,
    error,
    createdAt,
    // Provide minimal result metadata if completed
    result: result
      ? {
          datasetId: result.datasetId,
          validation: result.validation?.summary || result.validation,
          rowCounts: result.rowCounts,
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

app.get('/api/datasets/:id/export', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { zipPath } = await generationService.exportDataset(id);
    res.download(zipPath);
  } catch (e) {
    next(e);
  }
});

app.post('/api/datasets/:id/modify', async (req, res, next) => {
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

// UI configuration / limits endpoint
app.get('/api/config', (_req, res) => {
  res.json({
    maxRowsPerTable: Number(process.env.MAX_ROWS_PER_TABLE || 5000),
    defaultNumRecords: Number(process.env.DEFAULT_NUM_RECORDS || 100),
    aiEnabled: process.env.USE_AI !== 'false',
    model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
  });
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
