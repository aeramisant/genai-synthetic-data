import './TemperatureSlider.css';
import { useId } from 'react';

function TemperatureSlider() {
  const temperatureId = useId();
  return (
    <div className="temperature-slider">
      <label htmlFor={temperatureId}>Temperature:</label>
      <input type="range" id={temperatureId} min="0" max="1" step="0.1" />
    </div>
  );
}

export default TemperatureSlider;
