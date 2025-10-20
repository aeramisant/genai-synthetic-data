import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import RawMetaViewer from './RawMetaViewer';
import DataTable from './DataTable';
import QuickEdit from './QuickEdit';
import './DataPreview.css';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

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
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<DatasetPayload | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const pollRef = useRef<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [jobCompleted, setJobCompleted] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [liveData, setLiveData] = useState<Record<string, Row[]>>({});
  // Raw/meta/validation visualization moved into RawMetaViewer to isolate removable debug UI

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Initialize socket connection once
  useEffect(() => {
    if (socketRef.current) return;
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Poll job status if jobId provided
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    setStatus('checking');
    setError(null);
    setDataset(null);
    setSelectedTable('');
    setDatasetId(null);
    setJobCompleted(false);
    setLiveData({});

    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:4000/api/jobs/${jobId}`);
        if (!res.ok) throw new Error('Failed to fetch job');
        const job = await res.json();
        setStatus(job.status);
        if (typeof job.progress === 'number') setProgress(job.progress);
        if (job.phase) setPhase(job.phase);
        if (
          job.status === 'completed' ||
          job.status === 'error' ||
          job.status === 'cancelled'
        ) {
          setJobCompleted(true);
          stopPolling();
          if (job.status === 'completed') {
            const id = job.result?.datasetId;
            if (id) {
              setDatasetId(id);
              try {
                window.dispatchEvent(
                  new CustomEvent('dataset:created', { detail: { id } })
                );
              } catch {
                /* ignore dispatch errors */
              }
            }
          } else if (job.status === 'error') {
            setError(job.error || 'Job failed');
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Job polling failed';
        setError(msg);
        stopPolling();
      }
    };

    // Initial fetch then interval
    poll();
    pollRef.current = window.setInterval(poll, 1200);
  }, [jobId, stopPolling]);

  // Subscribe to socket job events for streaming updates
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !jobId) return;

    const handleStatus = (payload: { status?: string; progress?: number }) => {
      if (payload.status) setStatus(payload.status);
      if (typeof payload.progress === 'number') setProgress(payload.progress);
    };
    const handleProgress = (payload: { progress?: number; phase?: string }) => {
      if (typeof payload.progress === 'number') setProgress(payload.progress);
      if (payload.phase) setPhase(payload.phase);
    };
    const handleTableStart = (payload: { table: string }) => {
      setLiveData((prev) => ({
        ...prev,
        [payload.table]: prev[payload.table] || [],
      }));
      setSelectedTable((prev) => prev || payload.table);
    };
    const handleTableChunk = (payload: {
      table: string;
      chunk: Row[];
      delivered?: number;
      total?: number;
    }) => {
      if (!Array.isArray(payload.chunk) || !payload.table) return;
      setLiveData((prev) => {
        const existing = prev[payload.table] || [];
        return { ...prev, [payload.table]: [...existing, ...payload.chunk] };
      });
      setSelectedTable((prev) => (prev ? prev : payload.table));
    };
    const handleTableComplete = (payload: { table: string; rows?: number }) => {
      if (payload.table) {
        setLiveData((prev) => ({
          ...prev,
          [payload.table]: prev[payload.table] || [],
        }));
      }
    };
    const handleCompleted = (payload: {
      status?: string;
      result?: { datasetId?: number };
    }) => {
      if (payload.status) setStatus(payload.status);
      if (payload.result?.datasetId) {
        setDatasetId(payload.result.datasetId);
      }
      setJobCompleted(true);
      stopPolling();
    };
    const handleError = (payload: { error?: string }) => {
      if (payload.error) setError(payload.error);
      stopPolling();
    };

    socket.emit('subscribe:job', { jobId });
    socket.on('job:status', handleStatus);
    socket.on('job:progress', handleProgress);
    socket.on('job:tableStart', handleTableStart);
    socket.on('job:tableChunk', handleTableChunk);
    socket.on('job:tableComplete', handleTableComplete);
    socket.on('job:completed', handleCompleted);
    socket.on('job:error', handleError);

    return () => {
      socket.emit('unsubscribe:job', { jobId });
      socket.off('job:status', handleStatus);
      socket.off('job:progress', handleProgress);
      socket.off('job:tableStart', handleTableStart);
      socket.off('job:tableChunk', handleTableChunk);
      socket.off('job:tableComplete', handleTableComplete);
      socket.off('job:completed', handleCompleted);
      socket.off('job:error', handleError);
    };
  }, [jobId, stopPolling]);

  // External dataset selection override
  // Avoid overriding while an active generation job is running OR immediately after a job completion introducing a new dataset.
  useEffect(() => {
    const activeJobInProgress =
      jobId && !['completed', 'error', 'cancelled'].includes(status);
    if (activeJobInProgress) return; // defer override until job finished or absent
    // If a job just completed and provided datasetId, prefer showing it even if sidebar still points to older dataset
    if (jobCompleted && jobId && datasetId && datasetIdExternal !== datasetId) {
      return; // keep newly generated dataset in view until user explicitly selects another
    }
    if (datasetIdExternal && datasetIdExternal !== datasetId) {
      setDatasetId(datasetIdExternal);
      setDataset(null);
      setSelectedTable('');
    }
  }, [datasetIdExternal, datasetId, jobId, status, jobCompleted]);

  const fetchDataset = useCallback(
    async (id: number | null = datasetId) => {
      if (!id) return;
      try {
        const res = await fetch(
          `http://localhost:4000/api/datasets/${id}?includeData=true`
        );
        if (!res.ok) throw new Error('Failed to load dataset');
        const payload = await res.json();
        const normalized: DatasetPayload = {
          metadata: payload.metadata || { id },
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
    },
    [datasetId, selectedTable]
  );

  // Fetch dataset when we have a datasetId (internal or external)
  useEffect(() => {
    fetchDataset();
  }, [fetchDataset]);
  // Derived values for rendering
  const effectiveData = useMemo(() => {
    if (dataset?.data && Object.keys(dataset.data).length) {
      return dataset.data;
    }
    return liveData;
  }, [dataset?.data, liveData]);
  const tables = Object.keys(effectiveData || {});
  const rows =
    selectedTable && effectiveData ? effectiveData[selectedTable] || [] : [];
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
      {(!datasetId || !dataset) && (
        <>
          {jobId && (
            <div className="job-status">
              <strong>Job:</strong> {jobId} | <strong>Status:</strong> {status}
              {status !== 'completed' && status !== 'error' && (
                <span> | Progress: {(progress * 100).toFixed(0)}%</span>
              )}
              {phase && status !== 'completed' && status !== 'error' && (
                <span style={{ marginLeft: 8 }}> | Phase: {phase}</span>
              )}
            </div>
          )}
          {(status === 'running' ||
            status === 'error' ||
            status === 'completed') &&
            (() => {
              const pct = Math.min(100, Math.max(0, progress * 100));
              const phaseDescriptions: Record<string, string> = {
                created: 'Job created and queued',
                parsing: 'Parsing DDL schema and building internal model',
                generating:
                  'Generating table data via AI (one table at a time)',
                validating: 'Running PK/FK/NOT NULL validation checks',
                saving: 'Persisting dataset rows & metadata to database',
                completed: 'Generation finished successfully',
              };
              const desc = phaseDescriptions[phase] || 'Initializing job';
              let barColor = '#1e63c3';
              if (status === 'error') barColor = '#c0392b';
              else if (status === 'completed') barColor = '#2c7a37';
              return (
                <div style={{ margin: '6px 0 12px', width: '100%' }}>
                  <div
                    style={{
                      height: '6px',
                      background: '#eee',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                    title={desc}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={desc}>
                    <div
                      style={{
                        width: `${pct.toFixed(1)}%`,
                        height: '100%',
                        background: barColor,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: '0.65rem',
                      marginTop: 4,
                      color: status === 'error' ? '#c0392b' : '#444',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                    <span>{desc}</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })()}
          {error && <div className="error">{error}</div>}
          {!error && !datasetId && jobCompleted && (
            <div className="warning">
              Generation finished but no dataset was persisted (datasetId is
              null). Pass a saveName in your request to persist, or modify the
              API to return transient data.
            </div>
          )}
        </>
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
      {(!datasetId || !dataset) && (
        <div className="quick-edit" style={{ opacity: 0.85 }}>
          <div
            style={{
              fontSize: '0.7rem',
              color: '#555',
              background: '#fafafa',
              border: '1px dashed #ccc',
              padding: '8px 10px',
              borderRadius: 4,
            }}>
            No dataset loaded yet. Generate data first, then you can apply
            table‑level modifications here (e.g. add rows, adjust values, tweak
            distributions).
          </div>
        </div>
      )}
      {dataset && datasetId && (
        <QuickEdit
          datasetId={datasetId}
          activeTable={selectedTable}
          onModified={() => fetchDataset(datasetId)}
        />
      )}
    </div>
  );
}

export default DataPreview;
