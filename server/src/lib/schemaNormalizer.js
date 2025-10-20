// schemaNormalizer.js
// Normalizes generated dataset rows to conform to the parsed schema definition.
// - Removes unexpected columns
// - Adds missing columns (sets to null) so shape is uniform
// - Optionally enforces NOT NULL (currently leaves null; validation may flag later)

export function normalizeDataset(schema, data) {
  if (!schema || !schema.tables || !data) return data;
  const out = {};
  for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
    const rows = Array.isArray(data[tableName]) ? data[tableName] : [];
    const colNames = Object.keys(tableSchema.columns || {});
    const normalized = rows.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row))
        return {};
      const cleaned = {};
      for (const c of colNames) {
        if (Object.hasOwn(row, c)) cleaned[c] = row[c];
        else cleaned[c] = null; // fill absent columns
      }
      // Drop extras implicitly (do not copy unknown keys)
      return cleaned;
    });
    out[tableName] = normalized;
  }
  // Carry over any tables generated that were NOT in schema (ignore them deliberately)
  return out;
}

export function normalizeTable(schema, tableName, rows) {
  if (!schema?.tables?.[tableName]) return rows;
  return normalizeDataset(
    { tables: { [tableName]: schema.tables[tableName] } },
    { [tableName]: rows }
  )[tableName];
}
