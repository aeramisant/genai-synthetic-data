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
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [targetRows, setTargetRows] = useState<number>(10);
  const targetRowsId = useId();
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
        config: {
          temperature,
          maxTokens,
          withMeta: true,
          numRecords: targetRows,
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
        <PromptInput />
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
          <div className="target-rows" style={{ marginTop: '8px' }}>
            <label
              style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600 }}
              htmlFor={targetRowsId}>
              Target Rows (advisory)
            </label>
            <input
              id={targetRowsId}
              type="number"
              min={1}
              max={1000}
              value={targetRows}
              onChange={(e) =>
                setTargetRows(parseInt(e.target.value || '0', 10) || 1)
              }
              style={{ width: '120px' }}
            />
          </div>
        </div>
        <button
          type="button"
          className={`generate-button ${isLoading ? 'loading' : ''}`}
          onClick={handleGenerate}
          disabled={isLoading || !ddlSchema}>
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
