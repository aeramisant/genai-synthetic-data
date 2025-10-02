import './MaxTokensInput.css';

import { useId } from 'react';

function MaxTokensInput() {
  const inputId = useId();
  return (
    <div className="max-tokens-input">
      <label htmlFor={inputId}>Max Tokens:</label>
      <input type="number" id={inputId} defaultValue="100" />
    </div>
  );
}

export default MaxTokensInput;
