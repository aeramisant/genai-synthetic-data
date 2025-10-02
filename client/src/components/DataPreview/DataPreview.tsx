import DataTable from './DataTable';
import QuickEdit from './QuickEdit';
import './DataPreview.css';

function DataPreview() {
  return (
    <div className="data-preview">
      <h2>Data Preview</h2>
      <div className="table-container">
        <DataTable />
      </div>
      <QuickEdit />
    </div>
  );
}

export default DataPreview;
