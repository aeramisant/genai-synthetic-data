import { GoogleGenerativeAI } from '@google/generative-ai';
import pkg from 'node-sql-parser';
const { Parser } = pkg;
import {
  generateDeterministicData,
  validateDeterministicData,
} from './deterministicGenerator.js';

// --- Helper utilities ----------------------------------------------------
function stripCodeFences(text) {
  return text
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .trim();
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

function cleanGeminiJSON(raw, expected = 'object') {
  if (!raw || typeof raw !== 'string') return expected === 'array' ? [] : {};
  let text = stripCodeFences(raw)
    // Normalize newlines / spacing
    .replace(/\\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();

  // Attempt to locate first JSON object or array if extra prose exists
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let sliceStart = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    sliceStart = Math.min(firstBrace, firstBracket);
  } else {
    sliceStart = firstBrace !== -1 ? firstBrace : firstBracket;
  }
  if (sliceStart > 0) text = text.slice(sliceStart);

  // Trim trailing prose after final closing bracket/brace
  const lastBrace = text.lastIndexOf('}');
  const lastBracket = text.lastIndexOf(']');
  const sliceEnd = Math.max(lastBrace, lastBracket);
  if (sliceEnd !== -1) text = text.slice(0, sliceEnd + 1);

  // Heuristic fixes for common truncations (very conservative)
  if (expected === 'array') {
    if (!text.startsWith('[')) text = '[' + text;
    if (!text.endsWith(']')) text = text + ']';
  } else {
    // object expected
    if (text.startsWith('[') && expected === 'object') {
      // wrap array in object under data key
      return { data: safeParseJSON(text) || [] };
    }
    if (!text.startsWith('{')) text = '{' + text;
    if (!text.endsWith('}')) text = text + '}';
  }

  // Last attempt: remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');

  const parsed = safeParseJSON(text);
  if (parsed !== null) return parsed;
  // Fallback minimal structure
  return expected === 'array' ? [] : {};
}

class DataGenerator {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    });
    this.parser = new Parser();
    this.options = {
      database: 'PostgreSQL',
      multipleStatements: true,
      includeEnums: true,
    };
  }

  /**
   * Pre-sanitize DDL to increase compatibility with node-sql-parser (PostgreSQL dialect)
   * - Convert AUTO_INCREMENT -> SERIAL
   * - Convert ENUM(...) -> TEXT
   * - Convert DATETIME -> TIMESTAMP
   * - Strip inline CHECK constraints (retain column definition)
   * - Remove trailing commas before )
   * - Remove duplicated semicolons
   */
  _sanitizeDDL(raw) {
    let ddl = raw.replace(/\r\n/g, '\n');
    // Remove BOM
    ddl = ddl.replace(/^\uFEFF/, '');
    // Remove block comments
    ddl = ddl.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove inline comments entirely (they often break parser mid-line)
    ddl = ddl.replace(/--[^\n]*$/gm, '');
    // AUTO_INCREMENT patterns
    ddl = ddl.replace(
      /\bINT\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi,
      'SERIAL PRIMARY KEY'
    );
    ddl = ddl.replace(
      /\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi,
      'SERIAL PRIMARY KEY'
    );
    ddl = ddl.replace(
      /\bINTEGER\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi,
      'SERIAL PRIMARY KEY'
    );
    ddl = ddl.replace(/\bAUTO_INCREMENT\b/gi, ''); // fallback removal
    // ENUM -> TEXT (simplify)
    ddl = ddl.replace(/ENUM\s*\([^)]*\)/gi, 'TEXT');
    // DATETIME -> TIMESTAMP (Postgres friendly)
    ddl = ddl.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
    // Inline CHECK constraints inside column definitions: col INT CHECK (...)
    ddl = ddl.replace(/CHECK\s*\(([^)(]*|\([^)(]*\))*\)/gi, '');

    // Remove multiple spaces (but keep newlines first to split statements reliably)
    ddl = ddl
      .replace(/\n+/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trimEnd())
      .join('\n');
    // Normalize statement terminators to semicolon + newline
    ddl = ddl.replace(/;\s*/g, ';\n');
    // Ensure commas before ) are clean
    ddl = ddl.replace(/,\s*\)/g, ')');
    return ddl;
  }

  _normalizeAISchema(parsed) {
    // If already shape { tables: { ... } } return as is
    if (parsed && typeof parsed === 'object' && parsed.tables) return parsed;
    const tables = {};
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const name = entry?.name || entry?.tableName || entry?.table || null;
        if (!name) continue;
        tables[name] = this._coerceTableShape(entry);
      }
      return { tables };
    }
    // Object with keys as table names or numeric indices
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && typeof v === 'object' && (v.columns || v.cols || v.schema)) {
        const name = v.name || v.tableName || k;
        tables[name] = this._coerceTableShape(v);
      } else if (
        Array.isArray(v) &&
        v.length &&
        typeof v[0] === 'object' &&
        !tables[k]
      ) {
        // Looks like data rows without schema; build columns from first row
        const sample = v[0];
        const cols = Object.fromEntries(
          Object.keys(sample).map((c) => [c, { type: 'text', nullable: true }])
        );
        tables[k] = { name: k, columns: cols, primaryKey: [], foreignKeys: [] };
      }
    }
    return { tables };
  }

  _coerceTableShape(entry) {
    const colsRaw = entry.columns || entry.cols || entry.schema || {};
    const columns = {};
    if (Array.isArray(colsRaw)) {
      for (const c of colsRaw) {
        if (!c) continue;
        const name = c.name || c.column || c.col || c[0];
        if (!name) continue;
        columns[name] = {
          type: (c.type || 'text').toString().toLowerCase(),
          nullable: c.nullable !== false,
        };
      }
    } else if (typeof colsRaw === 'object') {
      for (const [ck, cv] of Object.entries(colsRaw)) {
        if (cv && typeof cv === 'object') {
          columns[ck] = {
            type: (cv.type || 'text').toString().toLowerCase(),
            nullable: cv.nullable !== false,
          };
        } else {
          columns[ck] = { type: 'text', nullable: true };
        }
      }
    }
    const pk = Array.isArray(entry.primaryKey)
      ? entry.primaryKey
      : entry.primary_key || [];
    const fks = Array.isArray(entry.foreignKeys)
      ? entry.foreignKeys
      : Array.isArray(entry.foreign_keys)
      ? entry.foreign_keys
      : [];
    return {
      name: entry.name || entry.tableName || entry.table || 'unknown',
      columns,
      primaryKey: pk,
      foreignKeys: fks
        .map((f) => ({
          columns: f?.columns || f?.cols || [],
          referenceTable:
            f?.referenceTable ||
            f?.refTable ||
            f?.table ||
            f?.references ||
            f?.on ||
            undefined,
          referenceColumns:
            f?.referenceColumns || f?.refColumns || f?.refs || f?.columns || [],
        }))
        .filter((f) => (f.columns?.length || 0) > 0 && !!f.referenceTable),
    };
  }
  // Very lightweight fallback parser for simple CREATE TABLE statements (MySQL-ish syntax)
  _naiveParseDDL(ddl) {
    const schema = { tables: {}, relationships: [] };
    const blocks = ddl
      .replace(/--.*$/gm, '')
      .split(/CREATE TABLE/i)
      .slice(1) // first split chunk before first CREATE TABLE
      .map((b) => 'CREATE TABLE' + b);
    const fkRegex =
      /foreign key\s*\(([^)]+)\)\s*references\s*([`"']?)([A-Za-z0-9_]+)\2\s*\(([^)]+)\)/i;
    blocks.forEach((blk) => {
      const nameMatch = blk.match(
        /CREATE TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?\s*\(/i
      );
      if (!nameMatch) return;
      const tableName = nameMatch[1];
      const inside = blk.substring(blk.indexOf('(') + 1, blk.lastIndexOf(')'));
      const lines = inside
        .split(/,(?![^()]*\))/) // split on commas not inside parens
        .map((l) => l.trim())
        .filter((l) => l.length);
      const tableSchema = {
        name: tableName,
        columns: {},
        primaryKey: [],
        foreignKeys: [],
      };
      lines.forEach((line) => {
        const lower = line.toLowerCase();
        if (lower.startsWith('primary key')) {
          const cols = line.match(/\(([^)]+)\)/);
          if (cols) {
            tableSchema.primaryKey = cols[1]
              .split(/\s*,\s*/)
              .map((c) => c.replace(/[`"']/g, ''));
          }
          return;
        }
        if (lower.startsWith('foreign key')) {
          const m = line.match(fkRegex);
          if (m) {
            const cols = m[1]
              .split(/\s*,\s*/)
              .map((c) => c.replace(/[`"']/g, ''));
            const refTable = m[3];
            const refCols = m[4]
              .split(/\s*,\s*/)
              .map((c) => c.replace(/[`"']/g, ''));
            tableSchema.foreignKeys.push({
              columns: cols,
              referenceTable: refTable,
              referenceColumns: refCols,
            });
          }
          return;
        }
        // Column definition
        const colMatch = line.match(
          /^([`"']?)([A-Za-z0-9_]+)\1\s+([A-Za-z0-9_()',' ]+)/
        );
        if (colMatch) {
          const colName = colMatch[2];
          let typePart = colMatch[3].split(/\s+/)[0];
          if (/auto_increment/i.test(line)) typePart = 'serial';
          if (/enum/i.test(typePart)) typePart = 'text';
          const notNull = /not null/i.test(line);
          tableSchema.columns[colName] = { type: typePart, nullable: !notNull };
          if (/primary key/i.test(line)) {
            tableSchema.primaryKey.push(colName);
          }
        }
      });
      schema.tables[tableName] = tableSchema;
    });
    return schema;
  }

  _processAST(ast) {
    const schema = {
      tables: {},
      relationships: [],
    };

    // Handle both single statement and multiple statements
    const statements = Array.isArray(ast) ? ast : [ast];

    for (const statement of statements) {
      if (statement.type === 'create' && statement.keyword === 'table') {
        const tableName = statement.table[0].table;
        const tableSchema = {
          name: tableName,
          columns: {},
          primaryKey: [],
          foreignKeys: [],
        };

        // Process columns
        for (const col of statement.create_definitions) {
          if (col.resource === 'column') {
            let dataType = col.definition.dataType;
            if (/auto_increment/i.test(JSON.stringify(col))) {
              dataType = 'serial';
            }
            if (/enum/i.test(dataType)) {
              // Simplify ENUM to text for deterministic generator
              dataType = 'text';
            }
            const notNullExplicit =
              col.nullable && col.nullable.value === 'not null';
            tableSchema.columns[col.column.column] = {
              type: dataType,
              nullable: !notNullExplicit, // only false if explicitly NOT NULL
              default: col.definition.default?.value,
            };
          } else if (col.resource === 'constraint') {
            if (col.constraint_type === 'primary key') {
              tableSchema.primaryKey = col.definition.columns.map(
                (c) => c.column
              );
            } else if (col.constraint_type === 'foreign key') {
              tableSchema.foreignKeys.push({
                columns: col.definition.columns.map((c) => c.column),
                referenceTable: col.definition.reference.table,
                referenceColumns: col.definition.reference.columns.map(
                  (c) => c.column
                ),
              });
            }
          }
        }

        schema.tables[tableName] = tableSchema;
      }
    }

    return schema;
  }

  async _enhanceSchemaWithAI(schema, originalDDL) {
    const prompt = `
      Analyze this database schema and suggest:
      1. Realistic value ranges and patterns for each column
      2. Potential data relationships and constraints not explicitly defined
      3. Business rules that should be considered when generating data
      
      Schema:
      ${JSON.stringify(schema, null, 2)}
      
      Original DDL:
      ${originalDDL}
      
      Return the enhanced schema with your suggestions in JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const text = result.response.text();
    // Remove any markdown code blocks if present
    const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
    return { ...schema, suggestions: JSON.parse(jsonStr) };
  }

  async parseDDL(ddlContent) {
    const warnings = [];
    const original = ddlContent;
    const sanitized = this._sanitizeDDL(ddlContent);

    // Split CREATE TABLE blocks manually to allow partial recovery
    const blockRegex = /CREATE\s+TABLE\s+[A-Za-z0-9_"`]+\s*\([^;]+?\);/gi;
    const blocks = sanitized.match(blockRegex) || [];
    if (!blocks.length) {
      warnings.push({
        type: 'no-blocks',
        message: 'No CREATE TABLE blocks detected after sanitization',
      });
    }
    const recovered = { tables: {} };
    for (const rawBlock of blocks) {
      const tableNameMatch = rawBlock.match(
        /CREATE\s+TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?/i
      );
      const tableName = tableNameMatch ? tableNameMatch[1] : null;
      if (!tableName) {
        warnings.push({
          type: 'missing-name',
          message: 'Could not extract table name for a block',
        });
        continue;
      }
      let parsedOk = false;
      // Capture ENUM values and inline column-level CHECK constraints before modifications
      const enumValuesPerColumn = {}; // col -> [values]
      const inlineChecks = {}; // col -> expression
      const enumRegex = /[`"']?([A-Za-z0-9_]+)[`"']?\s+ENUM\s*\(([^)]+)\)/i;
      const checkInlineRegex =
        /[`"']?([A-Za-z0-9_]+)[`"']?\s+[^,]*?CHECK\s*\(([^)]+)\)/i;
      const rawLines = rawBlock.split(/\n/);
      for (const ln of rawLines) {
        const enumMatch = ln.match(enumRegex);
        if (enumMatch) {
          const col = enumMatch[1];
          // split enum list respecting quotes
          const listRaw = enumMatch[2];
          const vals = listRaw
            .split(/,(?=(?:[^']*'[^']*')*[^']*$)/) // split on commas not inside single quotes pairs
            .map((v) => v.trim().replace(/^'|'$/g, ''))
            .filter(Boolean);
          if (vals.length) enumValuesPerColumn[col] = vals;
        }
        const chk = ln.match(checkInlineRegex);
        if (chk) {
          const col = chk[1];
          const expr = chk[2].trim();
          inlineChecks[col] = expr;
        }
      }
      // Progressive simplifications for this block
      const simplifications = [
        { label: 'original-block', ddl: rawBlock },
        {
          label: 'strip-check',
          ddl: rawBlock.replace(/CHECK\s*\([^)]*\)/gi, ''),
        },
        {
          label: 'strip-enum',
          ddl: rawBlock.replace(/ENUM\s*\([^)]*\)/gi, 'VARCHAR(100)'),
        },
        { label: 'strip-comments', ddl: rawBlock.replace(/--[^\n]*$/gm, '') },
      ];
      for (const attempt of simplifications) {
        try {
          // Try both PostgreSQL and MySQL dialects for this attempt
          let schemaPiece = null;
          const dialects = ['PostgreSQL', 'MySQL'];
          for (const db of dialects) {
            try {
              const parser = new Parser();
              const ast = parser.parse(attempt.ddl, {
                database: db,
                multipleStatements: true,
                includeEnums: true,
              });
              schemaPiece = this._processAST(ast);
              if (schemaPiece?.tables?.[tableName]) {
                if (db !== this.options.database) {
                  warnings.push({
                    type: 'dialect-detection',
                    message: `Parsed table ${tableName} using ${db} dialect`,
                  });
                }
                break;
              }
            } catch (_) {
              // try next dialect
            }
          }
          if (!schemaPiece)
            throw new Error('All dialect parse attempts failed for block');
          if (schemaPiece.tables?.[tableName]) {
            recovered.tables[tableName] = schemaPiece.tables[tableName];
            // Attach enums & inline checks metadata if captured
            if (Object.keys(enumValuesPerColumn).length) {
              for (const [col, vals] of Object.entries(enumValuesPerColumn)) {
                if (recovered.tables[tableName].columns[col]) {
                  recovered.tables[tableName].columns[col].enumValues = vals;
                  // Coerce type to text if it was enum-like
                  if (
                    /enum/i.test(recovered.tables[tableName].columns[col].type)
                  ) {
                    recovered.tables[tableName].columns[col].type = 'text';
                  }
                }
              }
            }
            if (Object.keys(inlineChecks).length) {
              recovered.tables[tableName].checks =
                recovered.tables[tableName].checks || [];
              for (const [col, expr] of Object.entries(inlineChecks)) {
                recovered.tables[tableName].checks.push({
                  column: col,
                  expression: expr,
                  level: 'column',
                });
              }
            }
            if (attempt.label !== 'original-block') {
              warnings.push({
                type: 'block-simplified',
                message: `Table ${tableName} parsed after ${attempt.label}`,
              });
            }
            parsedOk = true;
            break;
          }
        } catch (_) {
          // continue trying silently
        }
      }
      if (!parsedOk) {
        // Regex salvage for columns
        const body = rawBlock.substring(
          rawBlock.indexOf('(') + 1,
          rawBlock.lastIndexOf(')')
        );
        const colLines = body
          .split(/,(?![^()]*\))/)
          .map((l) => l.trim())
          .filter(
            (l) =>
              l &&
              !/^FOREIGN\s+KEY/i.test(l) &&
              !/^PRIMARY\s+KEY/i.test(l) &&
              !/^UNIQUE/i.test(l) &&
              !/^CONSTRAINT/i.test(l)
          );
        const columns = {};
        colLines.forEach((line) => {
          const m = line.match(
            /^([`"']?)([A-Za-z0-9_]+)\1\s+([A-Za-z0-9_()]+)\b/i
          );
          if (m) {
            const cname = m[2];
            const ctype = /enum/i.test(m[3]) ? 'text' : m[3].toLowerCase();
            columns[cname] = {
              type: ctype,
              nullable: !/NOT\s+NULL/i.test(line),
            };
            // Attach salvaged enum values if available
            if (enumValuesPerColumn[cname]) {
              columns[cname].enumValues = enumValuesPerColumn[cname];
            }
            if (inlineChecks[cname]) {
              recovered.tables[tableName] = recovered.tables[tableName] || {
                name: tableName,
              };
              recovered.tables[tableName].checks =
                recovered.tables[tableName].checks || [];
              recovered.tables[tableName].checks.push({
                column: cname,
                expression: inlineChecks[cname],
                level: 'column',
              });
            }
          }
        });
        const fks = [];
        const fkRegex =
          /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([A-Za-z0-9_"`]+)\s*\(([^)]+)\)/gi;
        for (const match of rawBlock.matchAll(fkRegex)) {
          fks.push({
            columns: match[1]
              .split(/\s*,\s*/)
              .map((c) => c.replace(/[`"']/g, '')),
            referenceTable: match[2].replace(/[`"']/g, ''),
            referenceColumns: match[3]
              .split(/\s*,\s*/)
              .map((c) => c.replace(/[`"']/g, '')),
          });
        }
        recovered.tables[tableName] = {
          name: tableName,
          columns,
          primaryKey: [],
          foreignKeys: fks,
        };
        warnings.push({
          type: 'regex-salvage',
          message: `Table ${tableName} salvaged with regex fallback`,
        });
      }
    }

    if (Object.keys(recovered.tables).length === 0) {
      // Final AI fallback
      try {
        const prompt = `Parse this DDL and return JSON with tables mapping. Only JSON. DDL: ${original}`;
        const result = await this.model.generateContent(prompt);
        const text = result.response.text();
        const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const norm = this._normalizeAISchema(parsed);
        warnings.push({
          type: 'ai-fallback',
          message: 'AI schema recovery used (all parser attempts failed)',
        });
        norm.meta = norm.meta || {};
        norm.meta.parseWarnings = warnings;
        return norm;
      } catch (e) {
        const err = new Error('DDL parsing failed completely: ' + e.message);
        err.warnings = warnings;
        throw err;
      }
    }

    // Optional AI enhancement if enabled
    if (process.env.USE_AI !== 'false') {
      try {
        const enhanced = await this._enhanceSchemaWithAI(recovered, original);
        enhanced.meta = enhanced.meta || {};
        enhanced.meta.parseWarnings = warnings;
        return enhanced;
      } catch (e) {
        warnings.push({
          type: 'ai-enhance-skip',
          message: 'AI enhancement skipped: ' + e.message,
        });
      }
    }

    recovered.meta = recovered.meta || {};
    recovered.meta.parseWarnings = warnings;
    // Collect enums summary at schema meta level for easier client usage
    const enumSummary = {};
    for (const [t, def] of Object.entries(recovered.tables)) {
      for (const [c, colDef] of Object.entries(def.columns || {})) {
        if (colDef.enumValues) {
          enumSummary[t] = enumSummary[t] || {};
          enumSummary[t][c] = colDef.enumValues;
        }
      }
    }
    if (Object.keys(enumSummary).length) {
      recovered.meta.enums = enumSummary;
    }
    return recovered;
  }

  async generateSyntheticData(schema, instructions, config = {}) {
    const {
      numRecords = 100,
      perTableRowCounts = {},
      nullProbability = {},
      seed,
      withMeta = false,
      debug,
      temperature,
      abortSignal,
      onTableStart,
      onTableComplete,
      onProgress,
    } = config;
    const useAI = process.env.USE_AI !== 'false';

    // If AI disabled entirely -> deterministic path
    if (!useAI) {
      const deterministic = generateDeterministicData(schema, {
        globalRowCount: numRecords,
        perTable: perTableRowCounts,
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

    const tables = Object.keys(schema.tables);
    const generatedData = {};
    const aiErrors = [];

    // Resolve temperature precedence: config.temperature -> env.MODEL_TEMPERATURE
    let effectiveTemp = undefined;
    if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
      effectiveTemp = Math.min(Math.max(temperature, 0), 1);
    } else if (
      process.env.MODEL_TEMPERATURE !== undefined &&
      !Number.isNaN(Number(process.env.MODEL_TEMPERATURE))
    ) {
      effectiveTemp = Math.min(
        Math.max(Number(process.env.MODEL_TEMPERATURE), 0),
        1
      );
    }

    // Build a model instance with generationConfig if temperature specified
    const model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
      ...(effectiveTemp !== undefined
        ? { generationConfig: { temperature: effectiveTemp } }
        : {}),
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
      const prompt = `
        Generate synthetic data for the ${tableName} table.
        Generate ${numRecords} records while maintaining referential integrity.
        Table Schema: ${JSON.stringify(schema.tables[tableName], null, 2)}
        Full Schema Context: ${JSON.stringify(schema, null, 2)}
        Additional Instructions: ${
          instructions || 'Generate realistic and consistent data'
        }
        Return ONLY a JSON array of records for the ${tableName} table.
        IMPORTANT: Return only the JSON array without any markdown formatting or code blocks.`;

      let tableData = [];
      try {
        if (abortSignal?.aborted) throw new Error('Generation aborted');
        const timeoutMs = Number(process.env.AI_TABLE_TIMEOUT_MS || 25000);
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
            globalRowCount: perTableRowCounts[tableName] || numRecords,
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
          const cols = Object.keys(schema.tables[tableName].columns || {});
          const target = perTableRowCounts[tableName] || numRecords || 1;
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

    // Optionally validate whole dataset
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
          timeoutMs: Number(process.env.AI_TABLE_TIMEOUT_MS || 25000),
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
