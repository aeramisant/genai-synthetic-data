import './PromptInput.css';
import { useId } from 'react';

function PromptInput() {
  const promptId = useId();
  return (
    <div className="prompt-input">
      <label htmlFor={promptId}>Prompt:</label>
      <input
        type="text"
        id={promptId}
        placeholder="Enter your prompt here..."
      />
    </div>
  );
}

export default PromptInput;
