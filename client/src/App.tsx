import { useState } from 'react';
import './App.css';
import DataGeneration from './components/DataAssistant/DataGeneration';
import ChatWithAI from './components/DataAssistant/ChatWithAI';
import TalkToYourData from './components/DataAssistant/TalkToYourData';
import DatasetList from './components/DatasetList/DatasetList';

function App() {
  const [activeTab, setActiveTab] = useState('dataGeneration');
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(
    null
  );

  return (
    <div className="app">
      <nav className="navbar">
        <h1>Data Assistant</h1>
      </nav>
      <div className="container">
        <aside className="sidebar">
          <DatasetList
            onSelect={(id) => {
              setSelectedDatasetId(id);
            }}
            activeId={selectedDatasetId || undefined}
          />
          <button
            type="button"
            className={`sidebar-button ${
              activeTab === 'dataGeneration' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('dataGeneration')}>
            <i className="fas fa-database"></i> Data Generation
          </button>
          <button
            type="button"
            className={`sidebar-button ${
              activeTab === 'talkToYourData' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('talkToYourData')}>
            <i className="fas fa-chart-bar"></i> Talk to your data
          </button>
          <button
            type="button"
            className={`sidebar-button ${
              activeTab === 'chatWithAI' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('chatWithAI')}>
            <i className="fas fa-comment"></i> Chat with AI
          </button>
        </aside>
        <main className="content">
          {activeTab === 'dataGeneration' && (
            <DataGeneration
              selectedDatasetId={selectedDatasetId}
              onDatasetGenerated={(datasetId) =>
                setSelectedDatasetId(datasetId)
              }
            />
          )}
          {activeTab === 'talkToYourData' && <TalkToYourData />}
          {activeTab === 'chatWithAI' && <ChatWithAI />}
        </main>
      </div>
    </div>
  );
}

export default App;
