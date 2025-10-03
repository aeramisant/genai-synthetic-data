import './PromptInput.css';
import { useId, type ChangeEvent } from 'react';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
}

function PromptInput({
  value,
  onChange,
  label = 'Prompt / Instructions',
  placeholder = 'Describe the style, distributions, special cases, row count hints (e.g. ~25 orders, varied statuses, realistic dates)...',
  multiline = true,
  rows = 5,
  maxLength = 5000,
}: PromptInputProps) {
  const id = useId();
  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (e.target.value.length <= maxLength) onChange(e.target.value);
  };
  const remaining = maxLength - value.length;
  return (
    <div className="prompt-input">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          // Prevent uncontrolled resizing explosions; allow vertical only via CSS if desired
          rows={rows}
          placeholder={placeholder}
          onChange={handleChange}
          style={{ resize: 'vertical', width: '100%' }}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
        />
      )}
      <div
        className="prompt-hint"
        style={{ fontSize: '0.65rem', opacity: 0.75, marginTop: '4px' }}>
        {remaining} characters remaining
      </div>
    </div>
  );
}

export default PromptInput;
