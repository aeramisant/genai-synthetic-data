import { useState, useEffect } from 'react';
import './TalkToYourData.css';

type Message = {
  id: string;
  text: string;
  isUser: boolean;
  sqlQuery?: string;
  tableResults?: Array<Record<string, unknown>>;
  error?: string;
};

interface Dataset {
  id: number;
  name: string;
  created_at?: string;
}

function TalkToYourData() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(
    null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load available datasets
  useEffect(() => {
    const loadDatasets = async () => {
      try {
        const res = await fetch('http://localhost:4000/api/datasets?limit=50');
        if (!res.ok) throw new Error('Failed to load datasets');
        const data = await res.json();
        setDatasets(data);
        if (data.length > 0 && !selectedDatasetId) {
          setSelectedDatasetId(data[0].id);
        }
      } catch (error) {
        console.error('Error loading datasets:', error);
      }
    };
    loadDatasets();
  }, [selectedDatasetId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedDatasetId) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      isUser: true,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:4000/api/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input,
          datasetId: selectedDatasetId,
        }),
      });

      if (!response.ok) throw new Error('Query failed');
      const data = await response.json();

      // Add AI response with SQL and results
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.answer || 'Query executed successfully',
        isUser: false,
        sqlQuery: data.sqlQuery,
        tableResults: data.results,
        error: data.error,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, there was an error processing your query.',
        isUser: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="talk-to-your-data">
      <div className="dataset-selector">
        <label htmlFor={`dataset-select-${selectedDatasetId}`}>
          <strong>Select Dataset:</strong>
        </label>
        <select
          id={`dataset-select-${selectedDatasetId}`}
          value={selectedDatasetId || ''}
          onChange={(e) => setSelectedDatasetId(Number(e.target.value))}
          disabled={!datasets.length}>
          {datasets.map((ds) => (
            <option key={ds.id} value={ds.id}>
              {ds.name || `Dataset ${ds.id}`}
              {ds.created_at &&
                ` - ${new Date(ds.created_at).toLocaleDateString()}`}
            </option>
          ))}
        </select>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>
              👋 Welcome! Ask questions about your data in natural language.
            </p>
            <p className="example">
              Try: "Show me all authors" or "What are the top 5 books by
              revenue?"
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.isUser ? 'user' : 'assistant'}`}>
            {message.isUser ? (
              <div className="message-content">{message.text}</div>
            ) : (
              <div className="message-content">
                <div className="ai-response">{message.text}</div>
                {message.error && (
                  <div className="error-block">
                    <strong>Error:</strong> {message.error}
                  </div>
                )}
                {message.sqlQuery && (
                  <div className="sql-block">
                    <div className="sql-header">Generated SQL:</div>
                    <pre>
                      <code>{message.sqlQuery}</code>
                    </pre>
                  </div>
                )}
                {message.tableResults && message.tableResults.length > 0 && (
                  <div className="table-results">
                    <div className="table-header">
                      Results ({message.tableResults.length} rows):
                    </div>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            {Object.keys(message.tableResults[0]).map((key) => (
                              <th key={key}>{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {message.tableResults.slice(0, 10).map((row, idx) => (
                            <tr key={`${idx}-${row}`}>
                              {Object.values(row).map((val, i) => (
                                <td key={`${i}-${val}`}>{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {message.tableResults.length > 10 && (
                        <div className="table-note">
                          Showing first 10 of {message.tableResults.length} rows
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your data..."
          disabled={isLoading || !selectedDatasetId}
        />
        <button type="submit" disabled={isLoading || !selectedDatasetId}>
          {isLoading ? 'Thinking...' : '→'}
        </button>
      </form>
    </div>
  );
}

export default TalkToYourData;
