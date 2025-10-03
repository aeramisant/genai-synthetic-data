import './MaxTokensInput.css';

import { useId } from 'react';

interface MaxTokensInputProps {
  value: number;
  onChange: (value: number) => void;
}

function MaxTokensInput({ value, onChange }: MaxTokensInputProps) {
  const tokensId = useId();
  return (
    <div className="max-tokens-input">
      <label htmlFor={tokensId}>Max Tokens</label>
      <input
        type="number"
        id={tokensId}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min="1"
        max="32768"
      />
    </div>
  );
}

export default MaxTokensInput;
