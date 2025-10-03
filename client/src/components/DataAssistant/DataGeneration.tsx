import { useState, useId } from 'react';
import PromptInput from '../Form/PromptInput';
import SchemaUpload from '../Form/SchemaUpload';
import TemperatureSlider from '../Form/TemperatureSlider';
import MaxTokensInput from '../Form/MaxTokensInput';
import DataPreview from '../DataPreview/DataPreview';
import './DataGeneration.css';

interface DataGenerationProps {
  selectedDatasetId?: number | null;
}

function DataGeneration({ selectedDatasetId }: DataGenerationProps) {
  const [ddlSchema, setDdlSchema] = useState('');
  const [prompt, setPrompt] = useState('');
  const PROMPT_MAX = 5000;
  const promptTooLong = prompt.length > PROMPT_MAX;
  const promptNearLimit = !promptTooLong && prompt.length > PROMPT_MAX - 250; // last 250 chars warning
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [integrityRepair, setIntegrityRepair] = useState(false);
  const [targetRows, setTargetRows] = useState<number>(10);
  const [showAdvancedRows, setShowAdvancedRows] = useState(false);
  const [perTableOverrides, setPerTableOverrides] = useState<
    Record<string, number>
  >({});
  const [overrideText, setOverrideText] = useState('');
  const globalRowsId = useId();

  // Parse overrideText as simple lines: TableName=Number
  const parseOverrides = () => {
    const lines = overrideText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out: Record<string, number> = {};
    for (const line of lines) {
      const m = line.match(/^([^=:#]+)\s*[=:]\s*(\d+)$/);
      if (m) {
        out[m[1].trim()] = Math.max(1, Math.min(1000, parseInt(m[2], 10)));
      }
    }
    setPerTableOverrides(out);
  };
  // Target rows input removed: we rely on default (~10) or prompt instructions.
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  // Persist toggle removed; we always persist with an auto name

  const handleGenerate = async () => {
    if (!ddlSchema) {
      setError('Please upload a DDL schema first');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        ddl: ddlSchema,
        instructions: prompt.trim() || undefined,
        config: {
          temperature,
          maxTokens,
          withMeta: true,
          integrityRepair,
          numRecords: targetRows,
          perTableRowCounts: Object.keys(perTableOverrides).length
            ? perTableOverrides
            : undefined,
          // numRecords intentionally omitted; backend default (~10) applies.
        },
      };
      const autoName = `run_${Date.now()}`;
      payload.saveName = autoName;
      payload.description = 'Generated via UI (auto-persist Phase1)';

      const response = await fetch('http://localhost:4000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Generation failed');
      }

      const result = await response.json();
      setCurrentJobId(result.jobId || null);
      console.log('Generation started:', result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start generation'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="data-generation">
      <div className="form-section">
        <h2>Data Generation</h2>
        <PromptInput value={prompt} onChange={setPrompt} />
        {(promptTooLong || promptNearLimit) && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '0.7rem',
              color: promptTooLong ? '#c0392b' : '#b9770e',
              fontWeight: 500,
            }}>
            {promptTooLong
              ? `Prompt exceeds ${PROMPT_MAX} characters. Please shorten it by ${
                  prompt.length - PROMPT_MAX
                } characters.`
              : `Approaching ${PROMPT_MAX} character limit (${
                  PROMPT_MAX - prompt.length
                } remaining).`}
          </div>
        )}
        <SchemaUpload onSchemaLoad={setDdlSchema} />
        {ddlSchema && (
          <div className="schema-preview">
            <pre>{ddlSchema}</pre>
          </div>
        )}
        <hr />
        <div className="advanced-parameters">
          <h3>Advanced Parameters</h3>
          <TemperatureSlider value={temperature} onChange={setTemperature} />
          <MaxTokensInput value={maxTokens} onChange={setMaxTokens} />
          <div style={{ marginTop: '6px' }}>
            <label
              htmlFor={globalRowsId}
              style={{
                display: 'block',
                fontSize: '0.7rem',
                fontWeight: 600,
                marginBottom: 2,
              }}>
              Target Rows (advisory global)
            </label>
            <input
              id={globalRowsId}
              type="number"
              min={1}
              max={1000}
              value={targetRows}
              onChange={(e) =>
                setTargetRows(
                  Math.max(
                    1,
                    Math.min(1000, parseInt(e.target.value || '10', 10))
                  )
                )
              }
              style={{ width: 120 }}
            />
            <button
              type="button"
              onClick={() => setShowAdvancedRows((s) => !s)}
              style={{
                marginLeft: 10,
                fontSize: '0.65rem',
                padding: '2px 6px',
              }}>
              {showAdvancedRows ? 'Hide' : 'Per-table'}
            </button>
            {showAdvancedRows && (
              <div
                style={{
                  marginTop: 6,
                  border: '1px solid #ddd',
                  padding: 8,
                  borderRadius: 4,
                  background: '#fafafa',
                }}>
                <div
                  style={{
                    fontSize: '0.65rem',
                    marginBottom: 4,
                    lineHeight: 1.2,
                  }}>
                  Define per-table overrides (one per line):
                  <br />
                  <code>TableName=Rows</code> or <code>TableName:Rows</code>
                </div>
                <textarea
                  value={overrideText}
                  rows={4}
                  placeholder={`Orders=50\nOrderItems=120`}
                  onChange={(e) => setOverrideText(e.target.value)}
                  onBlur={parseOverrides}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                {Object.keys(perTableOverrides).length > 0 && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: '0.6rem',
                      color: '#555',
                      lineHeight: 1.2,
                    }}>
                    Active overrides:{' '}
                    {Object.entries(perTableOverrides)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: '6px' }}>
            <label style={{ fontSize: '0.75rem', display: 'flex', gap: 6 }}>
              <input
                type="checkbox"
                checked={integrityRepair}
                onChange={(e) => setIntegrityRepair(e.target.checked)}
              />
              <span>
                Integrity Repair (optional)
                <span
                  style={{
                    fontWeight: 400,
                    color: '#666',
                    marginLeft: 4,
                    fontSize: '0.65rem',
                  }}>
                  Fix PK/FK issues after generation; may adjust values.
                </span>
              </span>
            </label>
          </div>
          <p style={{ marginTop: '8px', fontSize: '0.75rem', lineHeight: 1.2 }}>
            Row counts are advisory. The model may deviate, but hints guide
            scale. Extremely large targets can exceed token budgets; aim for
            reasonable sizes (≤ 1000).
          </p>
        </div>
        <button
          type="button"
          className={`generate-button ${isLoading ? 'loading' : ''}`}
          onClick={handleGenerate}
          disabled={isLoading || !ddlSchema || promptTooLong}>
          {isLoading ? 'Generating...' : 'Generate'}
        </button>
        {error && <div className="generation-error">{error}</div>}
      </div>
      <DataPreview
        jobId={currentJobId}
        datasetIdExternal={selectedDatasetId || undefined}
      />
    </div>
  );
}

export default DataGeneration;
