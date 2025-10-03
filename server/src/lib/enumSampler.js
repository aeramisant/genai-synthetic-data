// Enum & constrained value sampling utilities

export function sampleEnum(values, rng = Math.random) {
  if (!Array.isArray(values) || !values.length) return null;
  return values[Math.floor(rng() * values.length)];
}

export function applyEnumSampling(schema, rowsPerTable, rng = Math.random) {
  // rowsPerTable: { tableName: [rowObj, ...] }
  for (const [table, def] of Object.entries(schema.tables || {})) {
    const rows = rowsPerTable[table];
    if (!rows || !rows.length) continue;
    for (const [col, colDef] of Object.entries(def.columns || {})) {
      if (Array.isArray(colDef.enumValues) && colDef.enumValues.length) {
        // Only fill null/undefined; don't overwrite existing values
        for (const r of rows) {
          if (r[col] === null || r[col] === undefined) {
            r[col] = sampleEnum(colDef.enumValues, rng);
          }
        }
      }
    }
  }
  return rowsPerTable;
}

export default { sampleEnum, applyEnumSampling };
