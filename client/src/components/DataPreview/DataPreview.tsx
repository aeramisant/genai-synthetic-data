import { useEffect, useState, useRef } from 'react';
import DataTable from './DataTable';
import QuickEdit from './QuickEdit';
import './DataPreview.css';

type Row = Record<string, unknown>;
interface DatasetPayloadMetaValidationSummary {
  fkViolations?: number;
  pkDuplicates?: number;
  notNullViolations?: number;
}
interface ValidationTableReport {
  rowCount?: number;
  pkDuplicates?: number;
  fkViolations?: number;
  notNullViolations?: number;
  fkCoverage?: { fk: string; coveredPct: number }[];
  [k: string]: unknown;
}
interface DatasetPayloadMeta {
  validation?: {
    summary?: DatasetPayloadMetaValidationSummary;
    tables?: Record<string, unknown>;
  };
  [k: string]: unknown;
}
interface DatasetPayload {
  metadata?: { id: number; name?: string; description?: string };
  rowCounts?: Record<string, number>;
  data?: Record<string, Row[]>;
  meta?: DatasetPayloadMeta;
}

interface DataPreviewProps {
  jobId?: string | null;
}

function DataPreview({ jobId }: DataPreviewProps) {
  const [status, setStatus] = useState<string>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<DatasetPayload | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const pollRef = useRef<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showValidationDetails, setShowValidationDetails] = useState(false);

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  // Poll job status if jobId provided
  useEffect(() => {
    if (!jobId) return;
    setStatus('checking');
    setError(null);
    setDataset(null);
    setSelectedTable('');
    setDatasetId(null);
    setJobCompleted(false);

    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:4000/api/jobs/${jobId}`);
        if (!res.ok) throw new Error('Failed to fetch job');
        const job = await res.json();
        setStatus(job.status);
        if (typeof job.progress === 'number') setProgress(job.progress);
        if (
          job.status === 'completed' ||
          job.status === 'error' ||
          job.status === 'cancelled'
        ) {
          setJobCompleted(true);
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (job.status === 'completed') {
            const id = job.result?.datasetId;
            if (id) {
              setDatasetId(id);
            }
          } else if (job.status === 'error') {
            setError(job.error || 'Job failed');
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Job polling failed';
        setError(msg);
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    };

    // Initial fetch then interval
    poll();
    pollRef.current = window.setInterval(poll, 1200);
  }, [jobId]);

  // Fetch dataset when we have a datasetId
  useEffect(() => {
    if (!datasetId) return;
    const fetchDataset = async () => {
      try {
        const res = await fetch(
          `http://localhost:4000/api/datasets/${datasetId}?includeData=true`
        );
        if (!res.ok) throw new Error('Failed to load dataset');
        const payload = await res.json();
        const normalized: DatasetPayload = {
          metadata: payload.metadata || { id: datasetId },
          rowCounts: payload.rowCounts || payload.meta?.rowCounts || {},
          data: payload.data || payload.meta?.data || payload.meta?.data,
          meta: payload.meta,
        };
        setDataset(normalized);
        const tables = Object.keys(normalized.data || {});
        if (tables.length && !selectedTable) setSelectedTable(tables[0]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to fetch dataset';
        setError(msg);
      }
    };
    fetchDataset();
  }, [datasetId, selectedTable]);

  const tables = Object.keys(dataset?.data || {});
  const rows =
    selectedTable && dataset?.data ? dataset.data[selectedTable] : [];
  const validationSummary = dataset?.meta?.validation?.summary as
    | DatasetPayloadMetaValidationSummary
    | undefined;
  const fkViolations = validationSummary?.fkViolations ?? 0;
  const pkDuplicates = validationSummary?.pkDuplicates ?? 0;
  const notNullViolations = validationSummary?.notNullViolations ?? 0;
  const validationTables: Record<string, ValidationTableReport> =
    (dataset?.meta?.validation?.tables as Record<
      string,
      ValidationTableReport
    >) || {};

  return (
    <div className="data-preview">
      <h2>Data Preview</h2>
      {jobId && (
        <div className="job-status">
          <strong>Job:</strong> {jobId} | <strong>Status:</strong> {status}
          {status !== 'completed' && status !== 'error' && (
            <span> | Progress: {(progress * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {!error && !datasetId && jobCompleted && (
        <div className="warning">
          Generation finished but no dataset was persisted (datasetId is null).
          Pass a saveName in your request to persist, or modify the API to
          return transient data.
        </div>
      )}
      {dataset && (
        <div style={{ margin: '10px 0', fontSize: '0.8rem' }}>
          <strong>Validation:</strong> PK dup: {pkDuplicates} | FK viol:{' '}
          {fkViolations} | NOT NULL viol: {notNullViolations}
          {fkViolations > 0 && (
            <span style={{ color: '#c0392b', marginLeft: 8 }}>
              Check foreign key generation logic
            </span>
          )}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '8px',
        }}>
        {tables.length > 0 && (
          <div className="table-selector">
            <label>
              Table:
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}>
                {tables.map((t) => (
                  <option key={t} value={t}>
                    {t} (
                    {dataset?.rowCounts?.[t] ?? dataset?.data?.[t]?.length ?? 0}{' '}
                    rows)
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {dataset && (
          <button
            type="button"
            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
            onClick={() => setShowRaw((r) => !r)}>
            {showRaw ? 'Hide Raw JSON' : 'Show Raw JSON'}
          </button>
        )}
        {dataset && (
          <button
            type="button"
            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
            onClick={() => setShowValidationDetails((v) => !v)}>
            {showValidationDetails
              ? 'Hide Validation Details'
              : 'Show Validation Details'}
          </button>
        )}
      </div>
      <div className="table-container">
        {rows && rows.length > 0 ? (
          <DataTable tableName={selectedTable} rows={rows} />
        ) : (
          <div className="placeholder">
            {status === 'running' && 'Waiting for data...'}
            {status === 'completed' && !rows?.length && 'No rows to display'}
          </div>
        )}
      </div>
      {showRaw && dataset?.data && (
        <div style={{ marginTop: '16px', width: '100%' }}>
          <h3 style={{ margin: '4px 0' }}>Raw Dataset JSON</h3>
          <pre
            style={{
              maxHeight: '340px',
              overflow: 'auto',
              background: '#1e1e1e',
              color: '#eee',
              padding: '12px',
              fontSize: '0.7rem',
              borderRadius: 6,
            }}>
            {JSON.stringify(dataset.data, null, 2)}
          </pre>
        </div>
      )}
      {showValidationDetails && dataset && (
        <div style={{ marginTop: '18px', width: '100%' }}>
          <h3 style={{ margin: '4px 0' }}>Validation Details</h3>
          <div
            style={{
              display: 'grid',
              gap: '8px',
              gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))',
            }}>
            {Object.entries(validationTables).map(([table, info]) => {
              const fkCoverage = (info?.fkCoverage || []) as Array<{
                fk: string;
                coveredPct: number;
              }>;
              return (
                <div
                  key={table}
                  style={{
                    border: '1px solid #333',
                    padding: 8,
                    borderRadius: 6,
                    background: '#111',
                  }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {table}
                  </div>
                  <div style={{ fontSize: '0.65rem', lineHeight: 1.4 }}>
                    Rows: {info?.rowCount ?? 0}
                    <br />
                    PK duplicates: {info?.pkDuplicates ?? 0}
                    <br />
                    FK violations: {info?.fkViolations ?? 0}
                    <br />
                    NOT NULL violations: {info?.notNullViolations ?? 0}
                    {fkCoverage.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <strong>FK coverage</strong>
                        {fkCoverage.map((fk) => (
                          <div
                            key={fk.fk}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                            }}>
                            <span>{fk.fk}</span>
                            <span
                              style={{
                                color:
                                  fk.coveredPct === 100
                                    ? '#2ecc71'
                                    : fk.coveredPct > 60
                                    ? '#f1c40f'
                                    : '#e74c3c',
                              }}>
                              {fk.coveredPct}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {fkViolations > 0 && (
            <div
              style={{ marginTop: 12, fontSize: '0.7rem', color: '#e67e22' }}>
              Tip: High FK violations often mean referenced parent rows were not
              generated first or key values (like author_id) are missing.
              Consider a post-processing pass to assign sequential IDs when AI
              omits them.
            </div>
          )}
        </div>
      )}
      <QuickEdit />
    </div>
  );
}

export default DataPreview;
