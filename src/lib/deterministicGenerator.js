// Deterministic synthetic data generator (fallback / offline mode)
// Generates per-table rows honoring simple PK/FK relationships.
// NOTE: Relies on the schema shape produced by DataGenerator._processAST

function topologicalSortTables(schema) {
  const inDegree = {};
  const graph = {};
  const tables = Object.keys(schema.tables || {});
  tables.forEach((t) => {
    inDegree[t] = 0;
    graph[t] = new Set();
  });

  tables.forEach((t) => {
    const fks = schema.tables[t].foreignKeys || [];
    fks.forEach((fk) => {
      const parent = fk.referenceTable;
      if (parent && parent !== t && graph[parent]) {
        if (!graph[parent].has(t)) {
          graph[parent].add(t);
          inDegree[t]++;
        }
      }
    });
  });

  const queue = [];
  Object.entries(inDegree).forEach(([t, deg]) => {
    if (deg === 0) queue.push(t);
  });
  const ordered = [];
  while (queue.length) {
    const t = queue.shift();
    ordered.push(t);
    graph[t].forEach((dep) => {
      inDegree[dep]--;
      if (inDegree[dep] === 0) queue.push(dep);
    });
  }
  // If cycle (unlikely in clean schema) append remaining
  if (ordered.length !== tables.length) {
    tables.forEach((t) => {
      if (!ordered.includes(t)) ordered.push(t);
    });
  }
  return ordered;
}

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function synthValue(colName, colDef, rowIndex, tableName, context) {
  const rawType = (colDef.type || '').toLowerCase();
  const fkSource = context.fkSources?.[tableName]?.[colName];
  if (fkSource) {
    // Sample existing parent values
    const { table: parentTable, column: parentCol } = fkSource;
    const parentRows = context.generated[parentTable] || [];
    const pool = parentRows
      .map((r) => r?.[parentCol])
      .filter((v) => v !== undefined && v !== null);
    if (pool.length) return randChoice(pool);
  }

  if (/serial|int/.test(rawType)) {
    return rowIndex + 1; // simple sequential
  }
  if (/boolean/.test(rawType)) {
    return rowIndex % 2 === 0;
  }
  if (/date/.test(rawType)) {
    // Recent 5 years random day
    const now = Date.now();
    const past = now - 1000 * 60 * 60 * 24 * 365 * 5;
    const d = new Date(past + Math.random() * (now - past));
    return d.toISOString().slice(0, 10);
  }
  if (/time/.test(rawType)) {
    const h = String(Math.floor(Math.random() * 24)).padStart(2, '0');
    const m = String(Math.floor(Math.random() * 60)).padStart(2, '0');
    const s = String(Math.floor(Math.random() * 60)).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  if (/char|text|uuid/.test(rawType)) {
    return `${tableName}_${colName}_${rowIndex + 1}`.slice(0, 50);
  }
  if (/numeric|decimal|real|double/.test(rawType)) {
    return parseFloat((Math.random() * 100).toFixed(2));
  }
  // Fallback generic
  return `${colName}_${rowIndex + 1}`;
}

function buildFkSources(schema) {
  // Map: table -> column -> { table: parentTable, column: parentCol }
  const map = {};
  Object.entries(schema.tables || {}).forEach(([table, tblDef]) => {
    (tblDef.foreignKeys || []).forEach((fk) => {
      fk.columns.forEach((col, idx) => {
        map[table] = map[table] || {};
        map[table][col] = {
          table: fk.referenceTable,
          column: fk.referenceColumns[idx],
        };
      });
    });
  });
  return map;
}

// Simple seedable RNG (LCG) for reproducibility when config.seed provided
function createRNG(seed) {
  let s = seed >>> 0;
  return () => {
    // LCG constants (Numerical Recipes)
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function inferPrimaryKey(tableName, tblDef) {
  if (Array.isArray(tblDef.primaryKey) && tblDef.primaryKey.length) {
    return tblDef.primaryKey;
  }
  // Heuristics: prefer column named 'id' then `${singular}_id` or tableName_id
  const cols = Object.entries(tblDef.columns || {});
  const lower = (s) => (s || '').toLowerCase();
  const direct = cols.find(
    ([name, def]) =>
      lower(name) === 'id' && /int|serial/.test(lower(def.type || ''))
  );
  if (direct) return [direct[0]];
  const tableId = cols.find(
    ([name, def]) =>
      (lower(name) === `${lower(tableName)}_id` ||
        lower(name).endsWith('_id')) &&
      /int|serial/.test(lower(def.type || ''))
  );
  if (tableId) return [tableId[0]];
  return []; // None inferred
}

/**
 * Generate deterministic synthetic data.
 * @param {Object} schema Parsed schema: { tables: { [tableName]: { columns, primaryKey, foreignKeys } } }
 * @param {Object} config Options
 * @param {number} [config.globalRowCount=25] Default row count per table
 * @param {Object} [config.perTable] Map tableName -> rowCount override
 * @param {Object} [config.nullProbability] Map of table -> { default, colName -> prob }
 * @param {number} [config.seed] Seed for reproducible generation
 * @param {boolean} [config.debug] Force debug logging (or set DEBUG_DATA_GEN=true)
 * @param {boolean} [config.withMeta] If true returns { data, meta }
 */
export function generateDeterministicData(schema, config = {}) {
  const generated = {};
  const fkSources = buildFkSources(schema);

  const globalCount = config.globalRowCount || 25;
  const perTable = config.perTable || {};
  const nullProbConfig = config.nullProbability || { default: 0 }; // Could extend later
  const debug = !!config.debug || process.env.DEBUG_DATA_GEN === 'true';
  const rng = config.seed !== undefined ? createRNG(config.seed) : Math.random;

  const order = topologicalSortTables(schema);
  const meta = {
    order,
    tables: {},
    seed: config.seed ?? null,
  };

  order.forEach((tableName) => {
    const tblDef = schema.tables[tableName];
    if (!tblDef) return;
    const rowCount = perTable[tableName] ?? globalCount;
    const columns = tblDef.columns || {};

    // Determine or infer PK(s)
    const pkCols = inferPrimaryKey(tableName, tblDef);
    meta.tables[tableName] = {
      rowCount,
      pkCols,
      fkCount: (tblDef.foreignKeys || []).length,
    };

    generated[tableName] = [];
    for (let i = 0; i < rowCount; i++) {
      const row = {};
      Object.entries(columns).forEach(([colName, colDef]) => {
        const lowerType = (colDef.type || '').toLowerCase();
        const tableNullProb =
          nullProbConfig[tableName]?.default ?? nullProbConfig.default ?? 0;
        const colNullProb =
          nullProbConfig[tableName]?.[colName] ?? tableNullProb;
        const nullable = colDef.nullable !== false; // treat undefined as nullable unless explicitly false
        const allowNull = nullable && !pkCols.includes(colName); // Never null a PK
        const makeNull = allowNull && rng() < colNullProb;
        if (makeNull) {
          row[colName] = null;
          return;
        }
        if (pkCols.includes(colName) && /int|serial/.test(lowerType)) {
          row[colName] = i + 1; // deterministic sequence
          return;
        }
        row[colName] = synthValue(colName, colDef, i, tableName, {
          generated,
          fkSources,
          rng,
        });
      });
      generated[tableName].push(row);
    }
  });

  // FK reconciliation pass (in case cycles or parent empty when child generated)
  Object.entries(schema.tables || {}).forEach(([table, tblDef]) => {
    (tblDef.foreignKeys || []).forEach((fk) => {
      const parentRows = generated[fk.referenceTable] || [];
      if (!parentRows.length) return; // nothing we can do
      const parentPool = new Map();
      fk.referenceColumns.forEach((rc) => {
        parentRows.forEach((pr) => {
          if (pr[rc] !== undefined && pr[rc] !== null)
            parentPool.set(pr[rc], true);
        });
      });
      const poolValues = Array.from(parentPool.keys());
      if (!poolValues.length) return;
      (generated[table] || []).forEach((row) => {
        fk.columns.forEach((c) => {
          const val = row[c];
          if (val === undefined || val === null || !parentPool.has(val)) {
            row[c] = poolValues[Math.floor(rng() * poolValues.length)];
          }
        });
      });
    });
  });

  if (debug) {
    // Build per-table column stats
    const tableStats = {};
    Object.entries(generated).forEach(([tableName, rows]) => {
      const cols = Object.keys(schema.tables?.[tableName]?.columns || {});
      const stats = {};
      cols.forEach((c) => {
        let nulls = 0;
        const distinct = new Set();
        for (let i = 0; i < rows.length; i++) {
          const v = rows[i][c];
          if (v === null || v === undefined) nulls++;
          else distinct.add(v);
          if (distinct.size > 50) break; // cap distinct tracking to keep light
        }
        const samples = [];
        for (let i = 0; i < rows.length && samples.length < 3; i++) {
          if (rows[i][c] !== undefined) samples.push(rows[i][c]);
        }
        stats[c] = {
          nulls,
          nullPct: rows.length ? +((nulls / rows.length) * 100).toFixed(2) : 0,
          distinct: distinct.size,
          sample: samples,
        };
      });
      tableStats[tableName] = {
        rows: rows.length,
        columns: stats,
      };
    });
    console.log(
      '[deterministicGenerator] stats:',
      JSON.stringify(tableStats, null, 2)
    );
    console.log(
      '[deterministicGenerator] meta summary:',
      JSON.stringify(meta, null, 2)
    );
  }

  // Optionally return meta externally without breaking existing callers
  if (config.withMeta) {
    return { data: generated, meta };
  }

  return generated;
}

export function validateDeterministicData(schema, data, options = {}) {
  const errors = [];
  const debug = options.debug || process.env.DEBUG_DATA_GEN === 'true';
  const report = {
    tables: {},
    summary: { pkDuplicates: 0, fkViolations: 0, notNullViolations: 0 },
  };

  Object.entries(schema.tables || {}).forEach(([table, tblDef]) => {
    const rows = data[table] || [];
    const tReport = {
      rowCount: rows.length,
      pkDuplicates: 0,
      fkViolations: 0,
      notNullViolations: 0,
      fkCoverage: [], // { fk: 'col->parent.col', coveredPct }
    };

    // Primary key uniqueness (single or composite)
    if (Array.isArray(tblDef.primaryKey) && tblDef.primaryKey.length) {
      const pkCols = tblDef.primaryKey;
      const seen = new Set();
      rows.forEach((r, idx) => {
        const keyVals = pkCols.map((c) => r[c]);
        if (keyVals.some((v) => v === null || v === undefined)) return; // skip incomplete pk
        const compositeKey = JSON.stringify(keyVals);
        if (seen.has(compositeKey)) {
          errors.push(
            `Duplicate PK ${table}(${pkCols.join(
              ','
            )})=${compositeKey} (row ${idx})`
          );
          tReport.pkDuplicates++;
        }
        seen.add(compositeKey);
      });
      report.summary.pkDuplicates += tReport.pkDuplicates;
    }

    // NOT NULL (columns explicitly marked nullable:false)
    Object.entries(tblDef.columns || {}).forEach(([colName, colDef]) => {
      if (colDef.nullable === false) {
        rows.forEach((r, idx) => {
          if (r[colName] === null || r[colName] === undefined) {
            errors.push(`NOT NULL violation ${table}.${colName} (row ${idx})`);
            tReport.notNullViolations++;
          }
        });
      }
    });
    report.summary.notNullViolations += tReport.notNullViolations;

    // Foreign key coverage & violations
    (tblDef.foreignKeys || []).forEach((fk) => {
      const parentTable = fk.referenceTable;
      const parentRows = data[parentTable] || [];
      // Build index on all referenced columns (only supports single-column & independent columns for coverage simple metric)
      fk.columns.forEach((c, idx) => {
        const parentCol = fk.referenceColumns[idx];
        const index = new Set(
          parentRows
            .map((pr) => pr[parentCol])
            .filter((v) => v !== null && v !== undefined)
        );
        let covered = 0;
        let total = 0;
        rows.forEach((r) => {
          const val = r[c];
          if (val !== null && val !== undefined) {
            total++;
            if (index.has(val)) covered++;
            else {
              errors.push(
                `FK violation ${table}.${c} -> ${parentTable}.${parentCol} value ${val}`
              );
              tReport.fkViolations++;
            }
          }
        });
        const pct = total ? +((covered / total) * 100).toFixed(2) : 0;
        tReport.fkCoverage.push({
          fk: `${c}->${parentTable}.${parentCol}`,
          coveredPct: pct,
        });
      });
    });
    report.summary.fkViolations += tReport.fkViolations;
    report.tables[table] = tReport;
  });

  const passed = errors.length === 0;
  if (debug) {
    console.log('[validation] report:', JSON.stringify(report, null, 2));
    if (!passed) {
      console.log('[validation] firstErrors:', errors.slice(0, 15));
    }
  }
  return { passed, errors, report };
}
