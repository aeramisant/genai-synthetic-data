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
    try {
      // First try to parse the DDL using the SQL parser
      const ast = this.parser.parse(ddlContent, this.options);

      // Transform the AST into a structured schema
      const schema = this._processAST(ast);

      // If parser produced no tables, attempt naive fallback regardless of AI flag
      if (!schema.tables || Object.keys(schema.tables).length === 0) {
        const naive = this._naiveParseDDL(ddlContent);
        if (naive.tables && Object.keys(naive.tables).length > 0) {
          return naive;
        }
      }

      // If AI usage disabled, skip enhancement to avoid network calls
      if (process.env.USE_AI === 'false') {
        if (!schema.tables || Object.keys(schema.tables).length === 0) {
          // Fallback naive parse for MySQL style (AUTO_INCREMENT / ENUM) DDL
          const naive = this._naiveParseDDL(ddlContent);
          return naive;
        }
        return schema;
      }

      // Use Gemini to enhance the schema with additional insights (best-effort)
      try {
        return await this._enhanceSchemaWithAI(schema, ddlContent);
      } catch (enhErr) {
        console.warn('AI schema enhancement skipped (error):', enhErr.message);
        return schema; // fallback to raw parsed schema
      }
    } catch (error) {
      console.error('Error parsing DDL:', error);

      // Fallback to using Gemini directly if SQL parsing fails
      const prompt = `
        Parse this DDL and return a JSON structure with:
        1. Table definitions
        2. Column types and constraints
        3. Relationships between tables
        
        DDL:
        ${ddlContent}

        IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
      `;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      // Remove any markdown code blocks if present
      const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
      return JSON.parse(jsonStr);
    }
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

    for (const tableName of tables) {
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
        const result = await model.generateContent(prompt);
        const rawText = result.response.text();
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

      generatedData[tableName] = tableData;
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
