import { GoogleGenerativeAI } from '@google/generative-ai';
import pkg from 'node-sql-parser';
const { Parser } = pkg;

// Lightweight helpers reused from prior monolith
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

export class SchemaParser {
  constructor(opts = {}) {
    this.options = {
      database: 'PostgreSQL',
      multipleStatements: true,
      includeEnums: true,
      ...opts,
    };
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.aiModel = genAI.getGenerativeModel({
        model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
      });
    }
  }

  _sanitizeDDL(raw) {
    let ddl = raw.replace(/\r\n/g, '\n');
    ddl = ddl
      .replace(/^\uFEFF/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*$/gm, '')
      .replace(
        /\bINT\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi,
        'SERIAL PRIMARY KEY'
      )
      .replace(
        /\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi,
        'SERIAL PRIMARY KEY'
      )
      .replace(
        /\bINTEGER\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi,
        'SERIAL PRIMARY KEY'
      )
      .replace(/\bAUTO_INCREMENT\b/gi, '')
      .replace(/ENUM\s*\([^)]*\)/gi, 'TEXT')
      .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
      .replace(/CHECK\s*\(([^)(]*|\([^)(]*\))*\)/gi, '')
      .replace(/;\s*/g, ';\n')
      .replace(/,\s*\)/g, ')');
    ddl = ddl
      .replace(/\n+/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trimEnd())
      .join('\n');
    return ddl;
  }

  _processAST(ast) {
    const schema = { tables: {}, relationships: [] };
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
        for (const col of statement.create_definitions) {
          if (col.resource === 'column') {
            let dataType = col.definition.dataType;
            if (/auto_increment/i.test(JSON.stringify(col)))
              dataType = 'serial';
            if (/enum/i.test(dataType)) dataType = 'text';
            const notNullExplicit =
              col.nullable && col.nullable.value === 'not null';
            tableSchema.columns[col.column.column] = {
              type: dataType,
              nullable: !notNullExplicit,
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

  _normalizeAISchema(parsed) {
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
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && typeof v === 'object' && (v.columns || v.cols || v.schema)) {
        const name = v.name || v.tableName || k;
        tables[name] = this._coerceTableShape(v);
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

  async enhanceWithAI(schema, originalDDL) {
    if (!this.aiModel) return schema;
    const prompt = `Enhance schema with semantic hints. Return ONLY JSON. Schema: ${JSON.stringify(
      schema
    )} DDL: ${originalDDL}`;
    try {
      const result = await this.aiModel.generateContent(prompt);
      const text = result.response.text();
      const cleaned = stripCodeFences(text);
      const parsed = safeParseJSON(cleaned);
      if (parsed) return { ...schema, suggestions: parsed };
    } catch {
      // non-fatal
    }
    return schema;
  }

  async parse(ddlContent) {
    const warnings = [];
    const debug = process.env.DEBUG_SCHEMA_PARSE === 'true';
    if (debug)
      console.log('[schemaParser] start parse len=', ddlContent?.length);
    const sanitized = this._sanitizeDDL(ddlContent);
    const blockRegex = /CREATE\s+TABLE\s+[A-Za-z0-9_"`]+\s*\([^;]+?\);/gi;
    const blocks = sanitized.match(blockRegex) || [];
    const recovered = { tables: {} };
    for (const rawBlock of blocks) {
      const tableNameMatch = rawBlock.match(
        /CREATE\s+TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?/i
      );
      const tableName = tableNameMatch ? tableNameMatch[1] : null;
      if (!tableName) {
        warnings.push({
          type: 'missing-name',
          message: 'Could not extract table name',
        });
        continue;
      }
      const enumValuesPerColumn = {};
      const inlineChecks = {};
      const enumRegex = /[`"']?([A-Za-z0-9_]+)[`"']?\s+ENUM\s*\(([^)]+)\)/i;
      const checkInlineRegex =
        /[`"']?([A-Za-z0-9_]+)[`"']?\s+[^,]*?CHECK\s*\(([^)]+)\)/i;
      for (const ln of rawBlock.split(/\n/)) {
        const enumMatch = ln.match(enumRegex);
        if (enumMatch) {
          const listRaw = enumMatch[2];
          const vals = listRaw
            .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
            .map((v) => v.trim().replace(/^'|'$/g, ''))
            .filter(Boolean);
          if (vals.length) enumValuesPerColumn[enumMatch[1]] = vals;
        }
        const chk = ln.match(checkInlineRegex);
        if (chk) inlineChecks[chk[1]] = chk[2].trim();
      }
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
      let parsedOk = false;
      for (const attempt of simplifications) {
        try {
          let schemaPiece = null;
          for (const db of ['PostgreSQL', 'MySQL']) {
            try {
              const parser = new Parser();
              const ast = parser.parse(attempt.ddl, {
                database: db,
                multipleStatements: true,
                includeEnums: true,
              });
              schemaPiece = this._processAST(ast);
              if (schemaPiece?.tables?.[tableName]) {
                if (db !== this.options.database)
                  warnings.push({
                    type: 'dialect-detection',
                    message: `Parsed ${tableName} with ${db}`,
                  });
                break;
              }
            } catch {
              /* try next */
            }
          }
          if (!schemaPiece) throw new Error('dialects failed');
          recovered.tables[tableName] = schemaPiece.tables[tableName];
          if (
            !recovered.tables[tableName].columns ||
            typeof recovered.tables[tableName].columns !== 'object'
          ) {
            recovered.tables[tableName].columns = {};
            warnings.push({
              type: 'missing-columns',
              message: `Injected empty columns for ${tableName}`,
            });
          }
          for (const [col, vals] of Object.entries(enumValuesPerColumn)) {
            if (recovered.tables[tableName].columns[col]) {
              recovered.tables[tableName].columns[col].enumValues = vals;
              if (/enum/i.test(recovered.tables[tableName].columns[col].type)) {
                recovered.tables[tableName].columns[col].type = 'text';
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
          if (attempt.label !== 'original-block')
            warnings.push({
              type: 'block-simplified',
              message: `Table ${tableName} parsed after ${attempt.label}`,
            });
          parsedOk = true;
          break;
        } catch {
          /* continue */
        }
      }
      if (!parsedOk) {
        // salvage
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
        for (const line of colLines) {
          const m = line.match(
            /^([`"']?)([A-Za-z0-9_]+)\1\s+([A-Za-z0-9_()]+)/i
          );
          if (m) {
            const cname = m[2];
            const ctype = /enum/i.test(m[3]) ? 'text' : m[3].toLowerCase();
            columns[cname] = {
              type: ctype,
              nullable: !/NOT\s+NULL/i.test(line),
            };
            if (enumValuesPerColumn[cname])
              columns[cname].enumValues = enumValuesPerColumn[cname];
          }
        }
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
          columns: columns || {},
          primaryKey: [],
          foreignKeys: fks,
        };
        warnings.push({
          type: 'regex-salvage',
          message: `Table ${tableName} salvaged with regex`,
        });
      }
    }

    if (Object.keys(recovered.tables).length === 0 && this.aiModel) {
      try {
        const fallbackPrompt = `Parse this DDL and return JSON {"tables":{...}} ONLY JSON: ${ddlContent}`;
        const result = await this.aiModel.generateContent(fallbackPrompt);
        const text = stripCodeFences(result.response.text());
        const parsed = safeParseJSON(text);
        if (parsed) {
          const norm = this._normalizeAISchema(parsed);
          warnings.push({
            type: 'ai-fallback',
            message: 'AI schema recovery used',
          });
          norm.meta = { parseWarnings: warnings };
          return norm;
        }
      } catch (errParse) {
        const err = new Error(
          'DDL parsing failed completely: ' + errParse.message
        );
        err.warnings = warnings;
        throw err;
      }
    }
    recovered.meta = recovered.meta || {};
    recovered.meta.parseWarnings = warnings;
    const enumSummary = {};
    for (const [t, def] of Object.entries(recovered.tables)) {
      for (const [c, colDef] of Object.entries(def.columns || {})) {
        if (colDef.enumValues) {
          enumSummary[t] = enumSummary[t] || {};
          enumSummary[t][c] = colDef.enumValues;
        }
      }
    }
    if (Object.keys(enumSummary).length) recovered.meta.enums = enumSummary;
    if (process.env.USE_AI !== 'false') {
      try {
        const enhanced = await this.enhanceWithAI(recovered, ddlContent);
        enhanced.meta = enhanced.meta || {};
        enhanced.meta.parseWarnings = warnings;
        return enhanced;
      } catch {
        /* ignore enhance errors */
      }
    }
    if (debug) {
      console.log(
        '[schemaParser] parsed tables:',
        Object.keys(recovered.tables)
      );
      for (const [t, def] of Object.entries(recovered.tables)) {
        console.log(
          '[schemaParser] table',
          t,
          'colCount=',
          Object.keys(def.columns || {}).length,
          'pk=',
          def.primaryKey,
          'fk=',
          (def.foreignKeys || []).length
        );
      }
    }
    return recovered;
  }
}

export default new SchemaParser();
