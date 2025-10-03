import { useState, useRef } from 'react';
import './SchemaUpload.css';

interface SchemaUploadProps {
  onSchemaLoad?: (schema: string) => void;
}

function SchemaUpload({ onSchemaLoad }: SchemaUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState<boolean>(false);

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    // Check file extension
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['sql', 'ddl', 'txt'].includes(extension || '')) {
      setError('Invalid file type. Please upload a .sql, .ddl, or .txt file');
      return;
    }

    try {
      setIsReading(true);
      const ddlContent = await file.text();
      onSchemaLoad?.(ddlContent);
      setError(null);
    } catch (err) {
      console.error('File read error:', err);
      setError('Failed to read file. Please try again.');
    } finally {
      setIsReading(false);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) await handleFileSelect(file);
  };

  return (
    <div className="schema-upload">
      <button
        type="button"
        className={`upload-area ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        disabled={isReading}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick();
          }
        }}
        tabIndex={0}
        aria-label="Upload DDL file">
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".sql,.ddl,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
        />
        <i className="fas fa-upload"></i>
        <span>
          {isReading
            ? 'Reading file...'
            : 'Drop your DDL file here or click to select'}
        </span>
        <br />
        <span className="supported-formats">
          Supported formats: SQL, DDL, TXT
        </span>
      </button>
      {/* Persist controls removed: dataset is always persisted with an auto-generated name now */}
      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}

export default SchemaUpload;
