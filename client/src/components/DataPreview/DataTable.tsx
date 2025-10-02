import './DataTable.css';

function DataTable() {
  // Sample data - replace with API fetch
  const data = [
    {
      id: '001',
      name: 'Sample Data 1',
      category: 'Category A',
      value: '245.50',
    },
    {
      id: '002',
      name: 'Sample Data 2',
      category: 'Category B',
      value: '127.80',
    },
    {
      id: '003',
      name: 'Sample Data 3',
      category: 'Category A',
      value: '389.20',
    },
  ];

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Category</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.id}>
            <td>{row.id}</td>
            <td>{row.name}</td>
            <td>{row.category}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;
