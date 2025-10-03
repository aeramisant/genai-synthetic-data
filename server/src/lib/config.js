// Simplified fixed configuration: keep Phase 1 minimal & predictable.
// We intentionally remove environment overrides for row counts & timeout.
// Row scaling or overrides can be added in later phases.

export const CONFIG = {
  DEFAULT_NUM_RECORDS: 10, // default rows per table
  MAX_ROWS_PER_TABLE: 1000, // allow advisory higher counts (Phase 1 expanded scope)
  AI_TABLE_TIMEOUT_MS: 25000, // still tweakable later if needed
};

export function clampRowCount(requested) {
  const n = Number(requested);
  if (!requested || Number.isNaN(n)) return CONFIG.DEFAULT_NUM_RECORDS;
  return Math.min(Math.max(1, n), CONFIG.MAX_ROWS_PER_TABLE);
}

// Temperature still allowed via request config; we no longer pull from env.
export function effectiveTemperature(override) {
  if (typeof override === 'number' && !Number.isNaN(override)) {
    return Math.min(Math.max(override, 0), 1);
  }
  return undefined; // unspecified
}

export function loadRuntimeMutables() {
  // No-op now (kept for compatibility if callers invoke it)
}
