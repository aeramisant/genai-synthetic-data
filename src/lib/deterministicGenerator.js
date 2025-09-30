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

export function validateDeterministicData(schema, data) {
  const errors = [];
  // PK uniqueness & FK presence
  Object.entries(schema.tables || {}).forEach(([table, tblDef]) => {
    const rows = data[table] || [];
    if (tblDef.primaryKey && tblDef.primaryKey.length === 1) {
      const pk = tblDef.primaryKey[0];
      const seen = new Set();
      rows.forEach((r, idx) => {
        const v = r[pk];
        if (v !== undefined && v !== null) {
          if (seen.has(v))
            errors.push(`Duplicate PK ${table}.${pk}=${v} (row ${idx})`);
          seen.add(v);
        }
      });
    }
    // FKs
    (tblDef.foreignKeys || []).forEach((fk) => {
      const parentTable = fk.referenceTable;
      const parentRows = data[parentTable] || [];
      const parentIndex = new Map();
      fk.referenceColumns.forEach((rc) => {
        parentRows.forEach((pr) => {
          parentIndex.set(pr[rc], true);
        });
      });
      rows.forEach((r) => {
        fk.columns.forEach((c, idx) => {
          const val = r[c];
          if (val !== null && val !== undefined && !parentIndex.has(val)) {
            errors.push(
              `FK violation ${table}.${c} -> ${parentTable}.${fk.referenceColumns[idx]} value ${val}`
            );
          }
        });
      });
    });
  });
  return { passed: errors.length === 0, errors };
}
