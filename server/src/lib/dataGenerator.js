// CLEAN REFACTORED IMPLEMENTATION
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  generateDeterministicData,
  validateDeterministicData,
} from './deterministicGenerator.js';
import schemaParserInstance, { SchemaParser } from './schemaParser.js';
import { applyEnumSampling } from './enumSampler.js';
import { CONFIG, effectiveTemperature, clampRowCount } from './config.js';
import { autoRepairForeignKeys } from './foreignKeyRepair.js';

// Simple topological ordering based on foreign key references (single-column only, best-effort)
function orderTablesForGeneration(schema) {
  const deps = {}; // table -> set(child)
  const indegree = {};
  const tables = Object.keys(schema.tables || {});
  tables.forEach((t) => {
    deps[t] = new Set();
    indegree[t] = 0;
  });
  tables.forEach((child) => {
    const fks = schema.tables[child].foreignKeys || [];
    fks.forEach((fk) => {
      if (
        fk.referenceTable &&
        fk.referenceTable !== child &&
        deps[fk.referenceTable]
      ) {
        if (!deps[fk.referenceTable].has(child)) {
          deps[fk.referenceTable].add(child);
          indegree[child]++;
        }
      }
    });
  });
  const queue = tables.filter((t) => indegree[t] === 0);
  const ordered = [];
  while (queue.length) {
    const t = queue.shift();
    ordered.push(t);
    deps[t].forEach((c) => {
      indegree[c]--;
      if (indegree[c] === 0) queue.push(c);
    });
  }
  // Fallback append remaining if cycle
  tables.forEach((t) => {
    if (!ordered.includes(t)) ordered.push(t);
  });
  return ordered;
}

// Helper utilities (AI cleanup)
function stripCodeFences(text) {
  return text
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .trim();
}
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
function cleanGeminiJSON(raw, expected = 'object') {
  if (!raw || typeof raw !== 'string') return expected === 'array' ? [] : {};
  let text = stripCodeFences(raw)
    .replace(/\\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const sliceStart =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
      ? firstBrace
      : Math.min(firstBrace, firstBracket);
  if (sliceStart > 0) text = text.slice(sliceStart);
  const lastBrace = text.lastIndexOf('}');
  const lastBracket = text.lastIndexOf(']');
  const sliceEnd = Math.max(lastBrace, lastBracket);
  if (sliceEnd !== -1) text = text.slice(0, sliceEnd + 1);
  if (expected === 'array') {
    if (!text.startsWith('[')) text = '[' + text;
    if (!text.endsWith(']')) text = text + ']';
  } else {
    if (text.startsWith('[')) return { data: safeParseJSON(text) || [] };
    if (!text.startsWith('{')) text = '{' + text;
    if (!text.endsWith('}')) text = text + '}';
  }
  text = text.replace(/,\s*([}\]])/g, '$1');
  const parsed = safeParseJSON(text);
  return parsed !== null ? parsed : expected === 'array' ? [] : {};
}

class DataGenerator {
  constructor() {
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.genAI = genAI;
      this.model = genAI.getGenerativeModel({
        model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
      });
    }
    this.schemaParser =
      schemaParserInstance instanceof SchemaParser
        ? schemaParserInstance
        : new SchemaParser();
  }

  async parseDDL(ddlContent) {
    return this.schemaParser.parse(ddlContent);
  }

  async generateSyntheticData(schema, instructions, config = {}) {
    const {
      numRecords = CONFIG.DEFAULT_NUM_RECORDS,
      perTableRowCounts = {},
      nullProbability = {},
      seed,
      withMeta = false,
      debug,
      temperature,
      maxTokens,
      strictAIMode,
      abortSignal,
      onTableStart,
      onTableComplete,
      onProgress,
    } = config;
    const useAI = process.env.USE_AI !== 'false';

    // If AI disabled entirely -> deterministic path
    if (!useAI) {
      const effectiveGlobal = clampRowCount(numRecords);
      const clampedPer = Object.fromEntries(
        Object.entries(perTableRowCounts || {}).map(([t, v]) => [
          t,
          clampRowCount(v),
        ])
      );
      const deterministic = generateDeterministicData(schema, {
        globalRowCount: effectiveGlobal,
        perTable: clampedPer,
        nullProbability,
        seed,
        debug,
        withMeta,
      });
      const dataOnly = withMeta ? deterministic.data : deterministic;
      const validation = validateDeterministicData(schema, dataOnly, { debug });
      if (!validation.passed) {
        console.warn(
          'Deterministic generation validation errors:',
          validation.errors.slice(0, 10)
        );
      }
      // Attach report if meta requested
      if (withMeta && deterministic.meta) {
        deterministic.meta.validation = validation.report;
      }
      return deterministic;
    }

    if (!schema || !schema.tables || !Object.keys(schema.tables).length) {
      throw new Error('Parsed schema has no tables');
    }
    const tables = orderTablesForGeneration(schema);
    const effectiveGlobal = clampRowCount(numRecords);
    const generatedData = {};
    const aiErrors = [];

    const effectiveTemp = effectiveTemperature(temperature);
    // Clamp max tokens within a reasonable bound (Gemini limits vary; choose conservative upper bound)
    let maxTokensApplied;
    if (typeof maxTokens === 'number' && !Number.isNaN(maxTokens)) {
      maxTokensApplied = Math.min(Math.max(64, Math.floor(maxTokens)), 8192);
    }
    const generationConfig = {};
    if (effectiveTemp !== undefined)
      generationConfig.temperature = effectiveTemp;
    if (maxTokensApplied !== undefined)
      generationConfig.maxOutputTokens = maxTokensApplied;
    const model = this.genAI?.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    });

    for (let i = 0; i < tables.length; i++) {
      const tableName = tables[i];
      if (typeof onTableStart === 'function') {
        try {
          onTableStart({ table: tableName, index: i, total: tables.length });
        } catch (_) {}
      }
      if (abortSignal?.aborted) {
        throw new Error('Generation aborted');
      }
      console.log(
        '[gen:table:start]',
        tableName,
        `(${i + 1}/${tables.length})`
      );
      const tableSchema = schema.tables[tableName];
      if (!tableSchema || !tableSchema.columns) {
        aiErrors.push(`Skip ${tableName}: missing schema.columns`);
        generatedData[tableName] = [];
        continue;
      }
      const prompt = `
        Generate synthetic data for the ${tableName} table.
  Generate ${effectiveGlobal} records while maintaining referential integrity.
        Table Schema: ${JSON.stringify(tableSchema, null, 2)}
        Full Schema Context: ${JSON.stringify(schema, null, 2)}
        Additional Instructions: ${
          instructions || 'Generate realistic and consistent data'
        }
        Return ONLY a JSON array of records for the ${tableName} table.
        IMPORTANT: Return only the JSON array without any markdown formatting or code blocks.`;

      let tableData = [];
      try {
        if (abortSignal?.aborted) throw new Error('Generation aborted');
        const timeoutMs = CONFIG.AI_TABLE_TIMEOUT_MS;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('AI table generation timeout')),
            timeoutMs
          )
        );
        const result = await Promise.race([
          model.generateContent(prompt),
          timeoutPromise,
        ]);
        const rawText = result.response.text();
        // Console log a trimmed view of the raw Gemini response so we can verify AI output before parsing
        try {
          const trimmed =
            rawText.length > 600 ? rawText.slice(0, 600) + '…' : rawText;
          console.log(
            '[ai:raw]',
            tableName,
            'chars=',
            rawText.length,
            '\n',
            trimmed
          );
        } catch (_) {
          /* ignore logging issues */
        }
        // cleanGeminiJSON may return an object/array when it successfully parses;
        // we only need a string for the subsequent startsWith/endsWith checks.
        const rawClean = cleanGeminiJSON(rawText, 'array');
        const cleanText =
          typeof rawClean === 'string' ? rawClean : JSON.stringify(rawClean);
        try {
          if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
            tableData = JSON.parse(cleanText);
          } else {
            const parsed = JSON.parse(cleanText);
            tableData = parsed[tableName] || Object.values(parsed)[0] || [];
          }
        } catch (parseErr) {
          aiErrors.push(`Parse error ${tableName}: ${parseErr.message}`);
          tableData = [];
        }
      } catch (apiErr) {
        aiErrors.push(`AI generation error ${tableName}: ${apiErr.message}`);
      }

      // If AI failed or returned empty -> deterministic fallback per table
      if (!Array.isArray(tableData) || tableData.length === 0) {
        const fallback = generateDeterministicData(
          { tables: { [tableName]: schema.tables[tableName] } },
          {
            globalRowCount: clampRowCount(
              perTableRowCounts[tableName] || effectiveGlobal
            ),
            nullProbability: nullProbability[tableName]
              ? { [tableName]: nullProbability[tableName] }
              : {},
            seed,
            debug,
          }
        );
        tableData = fallback[tableName] || [];
        // Absolute guard: if still empty, synthesize minimal rows
        if (!tableData.length) {
          const cols = Object.keys(tableSchema.columns || {});
          const target = clampRowCount(
            perTableRowCounts[tableName] || effectiveGlobal || 1
          );
          tableData = Array.from({ length: target }).map((_, i) => {
            const r = {};
            cols.forEach((c) => {
              r[c] = i + 1; // simple placeholder sequence values
            });
            return r;
          });
        }
      }
      console.log('[gen:table:complete]', tableName, 'rows=', tableData.length);

      generatedData[tableName] = tableData;
      if (typeof onTableComplete === 'function') {
        try {
          onTableComplete({
            table: tableName,
            index: i,
            total: tables.length,
            rows: tableData.length,
          });
        } catch (_) {}
      }
      if (typeof onProgress === 'function') {
        try {
          onProgress({
            phase: 'tables',
            completed: i + 1,
            total: tables.length,
            ratio: (i + 1) / tables.length,
          });
        } catch (_) {}
      }
    }

    applyEnumSampling(schema, generatedData); // fill enum placeholders
    const meta = { maxTokensApplied, strictAIMode: !!strictAIMode };
    autoRepairForeignKeys(schema, generatedData, meta, { enabled: true });
    const validation = validateDeterministicData(schema, generatedData, {
      debug,
    });
    if (!validation.passed) {
      console.warn(
        'Post-generation validation issues (first 10):',
        validation.errors.slice(0, 10)
      );
    }
    if (aiErrors.length) {
      console.warn('AI generation issues encountered:', aiErrors.slice(0, 5));
    }
    if (withMeta) {
      return {
        data: generatedData,
        meta: {
          ai: true,
          temperature: effectiveTemp,
          aiErrors,
          timeoutMs: CONFIG.AI_TABLE_TIMEOUT_MS,
          ...meta,
        },
      };
    }
    return generatedData;
  }

  async modifyGeneratedData(data, modifications) {
    const prompt = `
      Modify the following dataset according to these instructions:
      ${modifications}
      
      Current Data:
      ${JSON.stringify(data, null, 2)}
      
      Return the modified data in the same JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const text = result.response.text();
    // Remove any markdown code blocks if present
    const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
    return JSON.parse(jsonStr);
  }
}

export default DataGenerator;
