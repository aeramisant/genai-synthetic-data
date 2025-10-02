import './QuickEdit.css';

function QuickEdit() {
  return (
    <div className="quick-edit">
      <input type="text" placeholder="Enter quick edit instructions..." />
      <button type="button" className="submit-button">
        Submit
      </button>
    </div>
  );
}

export default QuickEdit;
