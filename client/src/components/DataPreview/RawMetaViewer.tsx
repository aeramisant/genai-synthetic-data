import { useState } from 'react';

interface ValidationSummary {
  fkViolations?: number;
  pkDuplicates?: number;
  notNullViolations?: number;
  [k: string]: unknown;
}
interface TableValidationInfo {
  rowCount?: number;
  pkDuplicates?: number;
  fkViolations?: number;
  notNullViolations?: number;
  fkCoverage?: unknown;
  [k: string]: unknown;
}
interface RawMetaViewerProps {
  data?: Record<string, unknown[]> | null;
  meta?: Record<string, unknown> | null;
  validationTables?: Record<string, TableValidationInfo>;
  validationSummary?: ValidationSummary;
}

// Encapsulates debug/raw visibility so it can be removed later without touching main preview logic.
function RawMetaViewer({
  data,
  meta,
  validationTables = {},
  validationSummary,
}: RawMetaViewerProps) {
  const [mode, setMode] = useState<'hidden' | 'raw' | 'meta' | 'validation'>(
    'hidden'
  );

  const cycle = () => {
    setMode((m) =>
      m === 'hidden'
        ? 'raw'
        : m === 'raw'
        ? 'meta'
        : m === 'meta'
        ? 'validation'
        : 'hidden'
    );
  };

  const label = () => {
    switch (mode) {
      case 'hidden':
        return 'Show Raw/Meta';
      case 'raw':
        return 'Show Meta';
      case 'meta':
        return 'Show Validation';
      case 'validation':
        return 'Hide Debug';
      default:
        return 'Toggle';
    }
  };

  let content: React.ReactNode = null;
  if (mode === 'raw' && data) {
    content = <pre className="raw-block">{JSON.stringify(data, null, 2)}</pre>;
  } else if (mode === 'meta' && meta) {
    const mt = meta.maxTokensApplied as number | undefined;
    content = (
      <div>
        {mt !== undefined && (
          <div
            style={{
              fontSize: '0.65rem',
              marginBottom: 4,
              color: '#aaa',
              fontFamily: 'monospace',
            }}>
            maxTokensApplied: {mt}
          </div>
        )}
        <pre className="raw-block">{JSON.stringify(meta, null, 2)}</pre>
      </div>
    );
  } else if (mode === 'validation') {
    content = (
      <div className="validation-block" style={{ fontSize: '0.65rem' }}>
        {validationSummary && (
          <div style={{ marginBottom: 8 }}>
            <strong>Summary:</strong> PK dup:{' '}
            {(validationSummary.pkDuplicates as number) || 0} | FK viol:{' '}
            {(validationSummary.fkViolations as number) || 0} | NOT NULL:{' '}
            {(validationSummary.notNullViolations as number) || 0}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gap: 6,
            gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
          }}>
          {Object.entries(validationTables).map(([table, infoRaw]) => {
            const info = infoRaw as TableValidationInfo;
            return (
              <div
                key={table}
                style={{
                  border: '1px solid #333',
                  padding: 6,
                  borderRadius: 4,
                }}>
                <div style={{ fontWeight: 600 }}>{table}</div>
                <div style={{ lineHeight: 1.3 }}>
                  Rows: {info.rowCount ?? 0}
                  <br />
                  PK dup: {info.pkDuplicates ?? 0}
                  <br />
                  FK viol: {info.fkViolations ?? 0}
                  <br />
                  NOT NULL: {info.notNullViolations ?? 0}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={cycle}
        style={{ padding: '6px 10px', fontSize: '0.7rem' }}>
        {label()}
      </button>
      {content && <div style={{ marginTop: 8 }}>{content}</div>}
    </div>
  );
}

export default RawMetaViewer;
