import { useState, useId } from 'react';
import './QuickEdit.css';

interface QuickEditProps {
  datasetId?: number | null;
  onModified?: () => void;
  activeTable?: string; // the ONLY table we will modify
}

function QuickEdit({ datasetId, onModified, activeTable }: QuickEditProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promptId = useId();
  // We always modify only the activeTable now.
  const effectiveTable = activeTable || '';

  const submit = async () => {
    if (!datasetId) {
      setError('No dataset loaded');
      return;
    }
    if (!prompt.trim()) return;
    if (!effectiveTable) {
      setError('Select a table first');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `http://localhost:4000/api/datasets/${datasetId}/modify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, tableName: effectiveTable }),
        }
      );
      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Modification failed');
      }
      const result = await res.json();
      setMessage('Modification applied');
      setPrompt('');
      if (onModified) onModified();
      console.log('Modify result', result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to modify');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="quick-edit">
      <h3 style={{ marginTop: 0 }}>Modify Table</h3>
      <div style={{ fontSize: '0.65rem', color: '#555', marginBottom: 6 }}>
        {activeTable ? (
          <>
            Target table: <strong>{activeTable}</strong>
          </>
        ) : (
          <span style={{ color: '#c0392b' }}>No table selected</span>
        )}
      </div>
      <div className="row" style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: '1 1 260px' }}>
          <label
            htmlFor={promptId}
            style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600 }}>
            Modification Prompt
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              activeTable
                ? `Describe changes to ${activeTable} (e.g. Add 3 new rows with realistic values)`
                : 'Select a table above first'
            }
            rows={3}
            disabled={!activeTable}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
      </div>
      <div
        style={{
          marginTop: '8px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}>
        <button
          type="button"
          className="submit-button"
          disabled={loading || !prompt.trim() || !activeTable}
          onClick={submit}>
          {loading ? 'Applying...' : 'Apply Modification'}
        </button>
        {message && <span style={{ color: '#2c7' }}>✔ {message}</span>}
        {error && <span style={{ color: '#c0392b' }}>{error}</span>}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: '0.65rem', color: '#555' }}>
        Modifications are AI-guided and may alter row counts. Validation runs
        after apply.
      </p>
    </div>
  );
}

export default QuickEdit;
