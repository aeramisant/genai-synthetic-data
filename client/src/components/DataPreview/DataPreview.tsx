import { useEffect, useState, useRef } from 'react';
import RawMetaViewer from './RawMetaViewer';
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
  datasetIdExternal?: number;
}

function DataPreview({ jobId, datasetIdExternal }: DataPreviewProps) {
  const [status, setStatus] = useState<string>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<DatasetPayload | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const pollRef = useRef<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [jobCompleted, setJobCompleted] = useState(false);
  // Raw/meta/validation visualization moved into RawMetaViewer to isolate removable debug UI

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

  // External dataset selection override
  useEffect(() => {
    if (datasetIdExternal && datasetIdExternal !== datasetId) {
      setDatasetId(datasetIdExternal);
      setDataset(null);
      setSelectedTable('');
    }
  }, [datasetIdExternal, datasetId]);

  // Fetch dataset when we have a datasetId (internal or external)
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
  const maxTokensApplied =
    (dataset?.meta?.maxTokensApplied as number) || undefined;

  const handleDownload = async () => {
    if (!datasetId) return;
    try {
      const res = await fetch(
        `http://localhost:4000/api/datasets/${datasetId}/export`
      );
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dataset_${datasetId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

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
          {maxTokensApplied !== undefined && (
            <span style={{ marginLeft: 8 }}>
              | maxTokensApplied: {maxTokensApplied}
            </span>
          )}
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
        {datasetId && (
          <button
            type="button"
            onClick={handleDownload}
            style={{ padding: '4px 10px' }}
            title="Download dataset as ZIP of CSV files">
            Download
          </button>
        )}
        {/* Debug buttons removed; consolidated in RawMetaViewer cycle button */}
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
      {dataset && (
        <RawMetaViewer
          data={dataset.data}
          meta={dataset.meta as Record<string, unknown>}
          validationTables={
            validationTables as Record<string, { [k: string]: unknown }>
          }
          validationSummary={
            validationSummary as {
              [k: string]: unknown;
              fkViolations?: number;
              pkDuplicates?: number;
              notNullViolations?: number;
            }
          }
        />
      )}
      <QuickEdit
        datasetId={datasetId}
        tables={tables}
        activeTable={selectedTable}
        onModified={() => {
          // refetch dataset after modification
          if (datasetId) {
            (async () => {
              try {
                const res = await fetch(
                  `http://localhost:4000/api/datasets/${datasetId}?includeData=true`
                );
                if (!res.ok) throw new Error('Failed to reload dataset');
                const payload = await res.json();
                const normalized: DatasetPayload = {
                  metadata: payload.metadata || { id: datasetId },
                  rowCounts: payload.rowCounts || payload.meta?.rowCounts || {},
                  data:
                    payload.data || payload.meta?.data || payload.meta?.data,
                  meta: payload.meta,
                };
                setDataset(normalized);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Failed to reload dataset'
                );
              }
            })();
          }
        }}
      />
    </div>
  );
}

export default DataPreview;
