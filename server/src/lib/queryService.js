import { pool } from './database.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGenerationTrace, finalizeTrace } from './monitoring.js';

class QueryService {
  constructor() {
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = genAI.getGenerativeModel({
        model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
      });
    }
  }

  /**
   * Fetch schema information for a dataset
   */
  async getDatasetSchema(datasetId) {
    const metaRes = await pool.query(
      'SELECT schema_definition FROM generated_datasets WHERE id = $1',
      [datasetId]
    );

    if (!metaRes.rows.length) {
      throw new Error('Dataset not found');
    }

    const schemaDef = metaRes.rows[0].schema_definition;

    // Get actual table and column information from generated data
    const dataRes = await pool.query(
      `SELECT DISTINCT ON (table_name) table_name, data 
       FROM generated_data 
       WHERE dataset_id = $1
       ORDER BY table_name, id`,
      [datasetId]
    );

    // Build actual schema from the data (use actual column names)
    const actualSchema = {};
    for (const row of dataRes.rows) {
      const tableName = row.table_name;
      const sampleRow = row.data;
      const columns = Object.keys(sampleRow);
      actualSchema[tableName] = { columns };
    }

    // Get all table names
    const tablesRes = await pool.query(
      'SELECT DISTINCT table_name FROM generated_data WHERE dataset_id = $1',
      [datasetId]
    );
    const tables = tablesRes.rows.map((r) => r.table_name);

    return {
      schema: schemaDef,
      actualSchema, // Actual column names from generated data
      tables,
      datasetId,
    };
  }

  /**
   * Check for prompt injection or jailbreak attempts
   */
  detectPromptInjection(question) {
    const suspiciousPatterns = [
      /ignore\s+(previous|all|above)\s+(instructions|prompts|rules)/i,
      /you\s+are\s+now\s+a/i,
      /forget\s+(everything|all|previous)/i,
      /system\s*:\s*/i,
      /\[INST\]/i,
      /\[\/INST\]/i,
      /<\|.*?\|>/,
      /DROP\s+TABLE/i,
      /DELETE\s+FROM/i,
      /TRUNCATE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+TABLE/i,
      /GRANT\s+/i,
      /REVOKE\s+/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(question)) {
        return {
          detected: true,
          reason: 'Suspicious pattern detected in question',
          pattern: pattern.toString(),
        };
      }
    }

    return { detected: false };
  }

  /**
   * Check if question is on-topic (data-related)
   */
  checkOnTopic(question) {
    const offTopicKeywords = [
      'write a poem',
      'tell me a joke',
      'story about',
      'recipe for',
      'how to make',
      'political',
      'religion',
      'weather',
    ];

    const lowerQ = question.toLowerCase();
    for (const keyword of offTopicKeywords) {
      if (lowerQ.includes(keyword)) {
        return {
          onTopic: false,
          reason: 'Question appears to be off-topic (not data-related)',
        };
      }
    }

    // Simple heuristic: if it contains SQL-like or data-related terms, likely on-topic
    const dataKeywords = [
      'show',
      'get',
      'find',
      'list',
      'count',
      'sum',
      'average',
      'how many',
      'what',
      'which',
    ];
    const hasDataKeyword = dataKeywords.some((kw) => lowerQ.includes(kw));

    if (!hasDataKeyword && question.length > 100) {
      return {
        onTopic: false,
        reason: 'Question does not appear to be a data query',
      };
    }

    return { onTopic: true };
  }

  /**
   * Generate SQL from natural language question
   */
  async generateSQL(question, schemaInfo) {
    const { actualSchema, tables } = schemaInfo;

    // Build schema context using ACTUAL column names from generated data
    // Important: Use actualSchema (not DDL) because Gemini might generate different
    // column names during data generation (e.g., "company_name" instead of "name")
    let schemaContext = '';
    if (actualSchema && Object.keys(actualSchema).length > 0) {
      schemaContext = Object.entries(actualSchema)
        .map(([tableName, tableDef]) => {
          const columns = tableDef.columns.map((col) => `  ${col}`).join('\n');
          return `Table: ${tableName}\nColumns:\n${columns}`;
        })
        .join('\n\n');
    } else {
      schemaContext = `Available tables: ${tables.join(', ')}`;
    }

    const prompt = `You are a SQL expert. Convert the following natural language question into a valid PostgreSQL query.

Available Schema:
${schemaContext}

User Question: "${question}"

Rules:
1. Return ONLY the SQL query without any explanation or markdown formatting
2. Use proper PostgreSQL syntax
3. Only query tables that exist in the schema
4. Use JOINs when referencing multiple tables
5. Limit results to 100 rows unless specifically asked for more
6. Do not use any destructive operations (DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER)
7. Only use SELECT statements

SQL Query:`;

    const result = await this.model.generateContent(prompt);
    let sqlQuery = result.response.text().trim();

    // Clean up the response
    sqlQuery = sqlQuery
      .replace(/```sql\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Remove any trailing semicolon and re-add one
    sqlQuery = sqlQuery.replace(/;+$/, '') + ';';

    return sqlQuery;
  }

  /**
   * Generate a natural language answer based on query results
   */
  async generateAnswer(question, sqlQuery, results) {
    // If no results, return a helpful message
    if (!results || results.length === 0) {
      return "I couldn't find any matching data for your question.";
    }

    // Limit data sent to Gemini (max 10 rows for context)
    const sampleResults = results.slice(0, 10);
    const resultSummary = JSON.stringify(sampleResults, null, 2);

    const prompt = `You are a helpful data analyst assistant. Answer the user's question based on the query results.

User Question: "${question}"

SQL Query Executed:
${sqlQuery}

Query Results (showing ${sampleResults.length} of ${results.length} rows):
${resultSummary}

Instructions:
1. Provide a clear, conversational answer to the user's question
2. Use the data from the query results to inform your answer
3. If the user asks you to transform/rewrite/summarize data, do it based on what's in the results
4. If showing multiple items, format them nicely (bullets, lists, etc.)
5. Be concise but informative
6. Don't mention the SQL query unless specifically asked
7. If there are more results than shown, mention "among ${results.length} results" or similar

Answer:`;

    const result = await this.model.generateContent(prompt);
    return result.response.text().trim();
  }

  /**
   * Execute SQL query safely on dataset
   */
  async executeQuery(sqlQuery, datasetId) {
    // Create a temporary view or use CTEs to query the JSON data
    // Since we store data as JSONB in generated_data table, we need to aggregate it

    // First, validate it's a SELECT query
    if (!/^\s*SELECT/i.test(sqlQuery)) {
      throw new Error('Only SELECT queries are allowed');
    }

    // Get all data for this dataset grouped by table
    const dataRes = await pool.query(
      'SELECT table_name, json_agg(data) as rows FROM generated_data WHERE dataset_id = $1 GROUP BY table_name',
      [datasetId]
    );

    if (!dataRes.rows.length) {
      throw new Error('No data found for this dataset');
    }

    // Create temporary tables for querying
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create temp tables
      for (const { table_name, rows } of dataRes.rows) {
        const tempTableName = `temp_${table_name.toLowerCase()}_${datasetId}`;

        // Drop if exists
        await client.query(`DROP TABLE IF EXISTS ${tempTableName}`);

        // Get first row to infer columns
        const firstRow = rows[0];

        // Normalize column names to lowercase (PostgreSQL default)
        // This ensures Gemini's unquoted SQL references work correctly
        const columns = Object.keys(firstRow)
          .map((col) => `${col.toLowerCase()} TEXT`)
          .join(', ');

        // Create temp table
        await client.query(`CREATE TEMP TABLE ${tempTableName} (${columns})`);

        // Insert data with normalized column names
        for (const row of rows) {
          const normalizedRow = {};
          for (const [key, value] of Object.entries(row)) {
            normalizedRow[key.toLowerCase()] = value;
          }

          const cols = Object.keys(normalizedRow).join(', ');
          const vals = Object.values(normalizedRow)
            .map((_, i) => `$${i + 1}`)
            .join(', ');
          const values = Object.values(normalizedRow);
          await client.query(
            `INSERT INTO ${tempTableName} (${cols}) VALUES (${vals})`,
            values
          );
        }
      }

      // Replace table names in query with temp table names
      let modifiedQuery = sqlQuery;
      for (const { table_name } of dataRes.rows) {
        const tempTableName = `temp_${table_name.toLowerCase()}_${datasetId}`;
        // Use word boundaries to avoid partial replacements (case-insensitive)
        const regex = new RegExp(`\\b${table_name}\\b`, 'gi');
        modifiedQuery = modifiedQuery.replace(regex, tempTableName);
      }

      console.log('[QueryService] Original SQL:', sqlQuery);
      console.log('[QueryService] Modified SQL:', modifiedQuery);

      // Execute the query
      const result = await client.query(modifiedQuery);

      await client.query('ROLLBACK'); // Clean up temp tables

      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Main query handler with guardrails and tracing
   */
  async handleQuery(question, datasetId, userId = 'anonymous') {
    const trace = createGenerationTrace({
      jobId: `query_${datasetId}_${Date.now()}`,
      userId,
      metadata: {
        operation: 'talk_to_data',
        datasetId,
        question: question.slice(0, 200),
      },
    });

    try {
      // Guardrail 1: Detect prompt injection
      const injectionCheck = this.detectPromptInjection(question);
      if (injectionCheck.detected) {
        const error = new Error('Potential prompt injection detected');
        if (trace) {
          trace.span({
            name: 'guardrail_injection_check',
            output: { blocked: true, reason: injectionCheck.reason },
            level: 'WARNING',
          });
        }
        throw error;
      }

      // Guardrail 2: Check if on-topic
      const topicCheck = this.checkOnTopic(question);
      if (!topicCheck.onTopic) {
        const error = new Error(
          'Question is off-topic. Please ask about the data.'
        );
        if (trace) {
          trace.span({
            name: 'guardrail_topic_check',
            output: { blocked: true, reason: topicCheck.reason },
            level: 'WARNING',
          });
        }
        throw error;
      }

      // Get schema
      const schemaInfo = await this.getDatasetSchema(datasetId);

      // Generate SQL
      const sqlQuery = await this.generateSQL(question, schemaInfo);

      if (trace) {
        trace.span({
          name: 'generate_sql',
          input: { question },
          output: { sqlQuery },
          metadata: { datasetId },
        });
      }

      // Execute query
      const results = await this.executeQuery(sqlQuery, datasetId);

      if (trace) {
        trace.span({
          name: 'execute_query',
          input: { sqlQuery },
          output: { rowCount: results.length },
          metadata: { datasetId },
        });
      }

      // Generate natural language answer based on results
      const answer = await this.generateAnswer(question, sqlQuery, results);

      if (trace) {
        trace.span({
          name: 'generate_answer',
          input: { question, resultCount: results.length },
          output: { answer: answer.slice(0, 500) },
          metadata: { datasetId },
        });
      }

      finalizeTrace(trace, {
        status: 'completed',
        datasetId,
        metadata: { resultCount: results.length, sqlGenerated: true },
      });

      return {
        answer,
        sqlQuery,
        results,
      };
    } catch (error) {
      finalizeTrace(trace, {
        status: 'error',
        error,
        metadata: { datasetId, question: question.slice(0, 100) },
      });
      throw error;
    }
  }
}

export default QueryService;
