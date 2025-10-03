import { useState } from 'react';
import PromptInput from '../Form/PromptInput';
import SchemaUpload from '../Form/SchemaUpload';
import TemperatureSlider from '../Form/TemperatureSlider';
import MaxTokensInput from '../Form/MaxTokensInput';
import DataPreview from '../DataPreview/DataPreview';
import './DataGeneration.css';

function DataGeneration() {
  const [ddlSchema, setDdlSchema] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [persistConfig, setPersistConfig] = useState<{
    persist: boolean;
    datasetName: string;
  }>({ persist: true, datasetName: '' });

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
          numRecords: 10,
        },
      };
      if (persistConfig.persist) {
        const autoName = `run_${Date.now()}`;
        const saveName = (persistConfig.datasetName || '').trim() || autoName;
        payload.saveName = saveName;
        payload.description = 'Generated via UI (manual trigger)';
      }

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
        <SchemaUpload
          onSchemaLoad={setDdlSchema}
          onPersistConfigChange={(cfg) => setPersistConfig(cfg)}
        />
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
      <DataPreview jobId={currentJobId} />
    </div>
  );
}

export default DataGeneration;
