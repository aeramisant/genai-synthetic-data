import { Langfuse } from 'langfuse';

let langfuseClient = null;
let langfuseEnabled = false;

export function initializeLangfuse() {
  const enabled = process.env.LANGFUSE_ENABLED === 'true';
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const host = process.env.LANGFUSE_HOST;

  if (!enabled) {
    console.log('[Langfuse] Disabled (set LANGFUSE_ENABLED=true to enable)');
    return;
  }

  if (!publicKey || !secretKey) {
    console.warn(
      '[Langfuse] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY'
    );
    return;
  }

  try {
    langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: host || 'https://cloud.langfuse.com',
      flushAt: 1, // Flush immediately for development
      flushInterval: 1000,
    });
    langfuseEnabled = true;
    console.log('[Langfuse] Initialized successfully');
  } catch (e) {
    console.error('[Langfuse] Initialization failed:', e.message);
  }
}

export function isLangfuseEnabled() {
  return langfuseEnabled && langfuseClient !== null;
}

export function getLangfuseClient() {
  return langfuseClient;
}

/**
 * Create a trace for a generation job
 */
export function createGenerationTrace({ jobId, userId, metadata = {} }) {
  if (!isLangfuseEnabled()) return null;
  try {
    return langfuseClient.trace({
      id: jobId,
      name: 'synthetic_data_generation',
      userId,
      metadata,
    });
  } catch (e) {
    console.error('[Langfuse] Failed to create trace:', e.message);
    return null;
  }
}

/**
 * Track schema parsing span
 */
export function trackSchemaParsing(trace, { ddl, result, durationMs }) {
  if (!trace) return;
  try {
    trace.span({
      name: 'parse_ddl_schema',
      input: { ddl: ddl.slice(0, 500) + (ddl.length > 500 ? '...' : '') },
      output: {
        tables: Object.keys(result?.tables || {}),
        tableCount: Object.keys(result?.tables || {}).length,
      },
      metadata: { durationMs },
    });
  } catch (e) {
    console.error('[Langfuse] Failed to track schema parsing:', e.message);
  }
}

/**
 * Track AI table generation span
 */
export function trackTableGeneration(
  trace,
  { tableName, prompt, response, rows, temperature, maxTokens, retries, error }
) {
  if (!trace) return;
  try {
    const span = trace.span({
      name: `generate_table_${tableName}`,
      input: { prompt: prompt.slice(0, 1000) },
      output: error
        ? { error: error.message || String(error) }
        : {
            rowCount: rows,
            sample: response?.slice(0, 500),
          },
      metadata: {
        tableName,
        temperature,
        maxTokens,
        retries: retries || 0,
        success: !error,
      },
      level: error ? 'ERROR' : 'DEFAULT',
    });
    if (error) {
      span.event({
        name: 'generation_error',
        metadata: { error: error.message || String(error) },
      });
    }
  } catch (e) {
    console.error('[Langfuse] Failed to track table generation:', e.message);
  }
}

/**
 * Track validation span
 */
export function trackValidation(trace, { validation, durationMs }) {
  if (!trace) return;
  try {
    trace.span({
      name: 'validate_dataset',
      output: {
        passed: validation.passed,
        summary: validation.report?.summary,
      },
      metadata: { durationMs, errorCount: validation.errors?.length || 0 },
      level: validation.passed ? 'DEFAULT' : 'WARNING',
    });
  } catch (e) {
    console.error('[Langfuse] Failed to track validation:', e.message);
  }
}

/**
 * Track dataset modification
 */
export function trackModification(
  trace,
  { datasetId, prompt, tableName, diff, error }
) {
  if (!trace) return;
  try {
    trace.span({
      name: 'modify_dataset',
      input: { prompt, tableName, datasetId },
      output: error ? { error: error.message } : { diff },
      metadata: { datasetId, tableName: tableName || 'all' },
      level: error ? 'ERROR' : 'DEFAULT',
    });
  } catch (e) {
    console.error('[Langfuse] Failed to track modification:', e.message);
  }
}

/**
 * Finalize trace with result
 */
export function finalizeTrace(trace, { status, datasetId, error, metadata }) {
  if (!trace) return;
  try {
    trace.update({
      output: error ? { error: error.message } : { datasetId },
      metadata: { ...metadata, status },
      level: error ? 'ERROR' : status === 'completed' ? 'DEFAULT' : 'WARNING',
    });
  } catch (e) {
    console.error('[Langfuse] Failed to finalize trace:', e.message);
  }
}

/**
 * Flush pending events (call on shutdown)
 */
export async function flushLangfuse() {
  if (!langfuseClient) return;
  try {
    await langfuseClient.flushAsync();
    console.log('[Langfuse] Flushed pending events');
  } catch (e) {
    console.error('[Langfuse] Flush failed:', e.message);
  }
}
