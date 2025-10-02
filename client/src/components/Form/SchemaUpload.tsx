import './SchemaUpload.css';

function SchemaUpload() {
  return (
    <div className="schema-upload">
      <button type="button" className="upload-button">
        <i className="fas fa-upload"></i> Upload DDL Schema
      </button>
      <span className="supported-formats">Supported formats: SQL, JSON</span>
    </div>
  );
}

export default SchemaUpload;
