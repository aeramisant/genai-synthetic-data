import './TemperatureSlider.css';
import { useId } from 'react';

interface TemperatureSliderProps {
  value: number;
  onChange: (value: number) => void;
}

function TemperatureSlider({ value, onChange }: TemperatureSliderProps) {
  const temperatureId = useId();
  return (
    <div className="temperature-slider">
      <label htmlFor={temperatureId}>Temperature: {value.toFixed(2)}</label>
      <input
        type="range"
        id={temperatureId}
        min="0"
        max="1"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default TemperatureSlider;
