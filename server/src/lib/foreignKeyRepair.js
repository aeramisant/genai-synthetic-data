// Foreign key & primary key auto-repair utility extracted for reuse / testing

// Heuristic single-column PK inference (mirrors logic in deterministicGenerator)
function inferSinglePK(tableName, def) {
  if (Array.isArray(def.primaryKey) && def.primaryKey.length === 1) {
    return def.primaryKey[0];
  }
  const cols = Object.entries(def.columns || {});
  const lower = (s) => (s || '').toLowerCase();
  // Prefer exact 'id'
  const direct = cols.find(
    ([name, colDef]) =>
      lower(name) === 'id' && /int|serial/.test(lower(colDef.type || ''))
  );
  if (direct) return direct[0];
  // Prefer tableName_id
  const tableId = cols.find(
    ([name, colDef]) =>
      (lower(name) === `${lower(tableName)}_id` ||
        lower(name).endsWith('_id')) &&
      /int|serial/.test(lower(colDef.type || ''))
  );
  if (tableId) return tableId[0];
  return null;
}

export function autoRepairForeignKeys(schema, data, meta = {}, options = {}) {
  if (options.enabled === false) return meta;
  const pkRewriteCounts = {};
  const fkRewriteCounts = {};
  const notes = [];

  // Ensure parent tables have at least one row if children reference them (synthesize minimal row)
  for (const [tableName, def] of Object.entries(schema.tables || {})) {
    if (!Array.isArray(def.primaryKey) || def.primaryKey.length !== 1) continue;
    const pkCol = def.primaryKey[0];
    if (!data[tableName] || data[tableName].length === 0) {
      data[tableName] = [{ [pkCol]: 1 }];
      pkRewriteCounts[tableName] = 1;
      notes.push(`Synthesized 1 parent row for empty table ${tableName}`);
    }
  }

  // Pass 1: repair single-column PKs (sequential numeric if invalid or non-numeric)
  for (const [tableName, def] of Object.entries(schema.tables || {})) {
    const pkCol = inferSinglePK(tableName, def);
    if (!pkCol) continue;
    const rows = data[tableName] || [];
    if (!rows.length) continue;
    let needsRewrite = false;
    const seen = new Set();
    let numericCount = 0;
    for (const r of rows) {
      const v = r[pkCol];
      if (
        v === null ||
        v === undefined ||
        (typeof v === 'string' && v.length > 40)
      ) {
        needsRewrite = true;
        break;
      }
      if (typeof v === 'number') numericCount++;
      const key = JSON.stringify(v);
      if (seen.has(key)) {
        needsRewrite = true;
        break;
      }
      seen.add(key);
    }
    if (!needsRewrite && numericCount === 0) needsRewrite = true; // textual UUID-like values replaced for Phase 1 simplicity
    if (needsRewrite) {
      let i = 1;
      for (const r of rows) r[pkCol] = i++;
      pkRewriteCounts[tableName] = rows.length;
    }
    // Additional guard: if after potential rewrite some rows still missing pkCol, assign sequential
    let missing = 0;
    for (const r of rows) {
      if (r[pkCol] === null || r[pkCol] === undefined) missing++;
    }
    if (missing) {
      let i = 1;
      for (const r of rows) {
        if (r[pkCol] === null || r[pkCol] === undefined) r[pkCol] = i++;
      }
      pkRewriteCounts[tableName] = (pkRewriteCounts[tableName] || 0) + missing;
      notes.push(
        `Filled ${missing} missing PK values for ${tableName}.${pkCol}`
      );
    }
  }

  // Build parent PK sets
  const parentPkSets = {};
  for (const [tableName, def] of Object.entries(schema.tables || {})) {
    const pkCol = inferSinglePK(tableName, def);
    if (!pkCol) continue;
    const set = new Set(
      (data[tableName] || [])
        .map((r) => r[pkCol])
        .filter((v) => v !== null && v !== undefined)
    );
    parentPkSets[tableName] = set;
    if (!Array.isArray(def.primaryKey) || def.primaryKey.length !== 1) {
      if (set.size)
        notes.push(
          `Inferred PK ${tableName}.${pkCol} (not declared in schema)`
        );
    }
  }

  // Pass 2: repair FK values (simple one-column FKs)
  for (const [tableName, def] of Object.entries(schema.tables || {})) {
    const rows = data[tableName] || [];
    if (!rows.length) continue;
    for (const fk of def.foreignKeys || []) {
      if (!fk.columns || !fk.referenceTable || !fk.referenceColumns) continue;
      if (fk.columns.length !== 1 || fk.referenceColumns.length !== 1) continue;
      const childCol = fk.columns[0];
      const parentTable = fk.referenceTable;
      const parentSet = parentPkSets[parentTable];
      if (!parentSet) {
        notes.push(`Parent set missing for FK ${tableName}.${childCol}`);
        continue;
      }
      let parentValues = Array.from(parentSet);
      if (!parentValues.length) {
        // If parent has rows but none with PK values, synthesize
        const pkCol = schema.tables[parentTable]?.primaryKey?.[0];
        if (pkCol) {
          data[parentTable] = [{ [pkCol]: 1 }];
          parentValues = [1];
          parentPkSets[parentTable].add(1);
          pkRewriteCounts[parentTable] =
            (pkRewriteCounts[parentTable] || 0) + 1;
          notes.push(`Inserted fallback PK=1 for parent ${parentTable}`);
        } else continue;
      }
      let rewrites = 0;
      let rrIdx = 0;
      for (const r of rows) {
        const val = r[childCol];
        if (val === null || val === undefined || !parentSet.has(val)) {
          r[childCol] = parentValues[rrIdx % parentValues.length];
          rrIdx++;
          rewrites++;
        }
      }
      if (rewrites) fkRewriteCounts[`${tableName}.${childCol}`] = rewrites;
    }
  }

  if (
    Object.keys(pkRewriteCounts).length ||
    Object.keys(fkRewriteCounts).length ||
    notes.length
  ) {
    meta.autoFixForeignKeys = {
      pkRewrites: pkRewriteCounts,
      fkRewrites: fkRewriteCounts,
      notes,
    };
  }
  return meta;
}

export default autoRepairForeignKeys;
