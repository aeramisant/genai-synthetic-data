import PromptInput from '../Form/PromptInput';
import SchemaUpload from '../Form/SchemaUpload';
import TemperatureSlider from '../Form/TemperatureSlider';
import MaxTokensInput from '../Form/MaxTokensInput';
import DataPreview from '../DataPreview/DataPreview';
import './DataGeneration.css';

function DataGeneration() {
  return (
    <div className="data-generation">
      <div className="form-section">
        <h2>Data Generation</h2>
        <PromptInput />
        <SchemaUpload />
        <hr />
        <div className="advanced-parameters">
          <h3>Advanced Parameters</h3>
          <TemperatureSlider />
          <MaxTokensInput />
        </div>
        <button type="button" className="generate-button">
          Generate
        </button>
      </div>
      <DataPreview />
    </div>
  );
}

export default DataGeneration;
