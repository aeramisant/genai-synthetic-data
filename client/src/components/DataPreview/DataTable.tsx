import './DataTable.css';

export interface DataTableProps {
  tableName: string;
  rows: Array<Record<string, unknown>>;
}

function DataTable({ tableName, rows }: DataTableProps) {
  if (!rows || rows.length === 0) {
    return <div className="empty-table">No rows for {tableName}</div>;
  }
  const columns = Object.keys(rows[0]);
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const keyCandidate = ['id', 'ID', 'uuid', '_id'].find(
            (k) => typeof row[k] === 'string' || typeof row[k] === 'number'
          );
          const compositeKey = keyCandidate
            ? String(row[keyCandidate])
            : `${tableName}-${idx}`;
          return (
            <tr key={compositeKey}>
              {columns.map((col) => (
                <td key={col}>{String(row[col] ?? '')}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default DataTable;
