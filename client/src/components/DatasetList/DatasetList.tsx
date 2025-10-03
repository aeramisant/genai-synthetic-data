import { useEffect, useState, useCallback } from 'react';
import ConfirmModal from '../Modal/ConfirmModal';
import './DatasetList.css';

interface DatasetListItem {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  rowCounts?: Record<string, number>;
}

interface DatasetListProps {
  onSelect: (id: number) => void;
  activeId?: number | null;
}

function DatasetList({ onSelect, activeId }: DatasetListProps) {
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:4000/api/datasets?limit=100');
      if (!res.ok) throw new Error('Failed to fetch datasets');
      const rows = await res.json();
      setDatasets(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load datasets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="dataset-list">
      <div className="dataset-list-header">
        <h3>Datasets</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="refresh-btn">
          {loading ? '…' : '↻'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <ul>
        {datasets.map((d) => (
          <li
            key={d.id}
            className={d.id === activeId ? 'active' : ''}
            title={d.description || ''}>
            <div
              className="dataset-row"
              style={{ display: 'flex', alignItems: 'stretch', gap: '4px' }}>
              <button
                type="button"
                className="dataset-item-btn"
                onClick={() => onSelect(d.id)}
                aria-pressed={d.id === activeId}>
                <div className="name">{d.name || `Dataset ${d.id}`}</div>
                <div className="meta">
                  {d.created_at && (
                    <span className="created">
                      {new Date(d.created_at).toLocaleTimeString()}
                    </span>
                  )}
                  {d.rowCounts && (
                    <span className="tables">
                      {Object.keys(d.rowCounts).length} tbl
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                className="delete-btn"
                aria-label={`Delete dataset ${d.name || d.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDeleteId(d.id);
                }}
                style={{
                  background: '#f9e6e6',
                  border: '1px solid #e1b5b5',
                  borderRadius: 4,
                  cursor: 'pointer',
                  padding: '0 6px',
                }}>
                {deleting && pendingDeleteId === d.id ? '…' : '✕'}
              </button>
            </div>
          </li>
        ))}
        {!datasets.length && !loading && (
          <li className="placeholder">No datasets yet</li>
        )}
      </ul>
      <ConfirmModal
        open={pendingDeleteId !== null}
        destructive
        title="Delete Dataset"
        message={
          <div>
            Permanently delete dataset ID <strong>{pendingDeleteId}</strong>?
            <br />
            This action cannot be undone.
          </div>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (pendingDeleteId === null) return;
          setDeleting(true);
          try {
            const res = await fetch(
              `http://localhost:4000/api/datasets/${pendingDeleteId}`,
              { method: 'DELETE' }
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Delete failed');
            }
            setDatasets((prev) => prev.filter((x) => x.id !== pendingDeleteId));
            if (pendingDeleteId === activeId) onSelect(NaN);
            setPendingDeleteId(null);
          } catch (delErr) {
            setError(
              delErr instanceof Error ? delErr.message : 'Delete failed'
            );
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

export default DatasetList;
