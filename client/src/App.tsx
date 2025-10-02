import { useState } from 'react';
import './App.css';
import DataGeneration from './components/DataAssistant/DataGeneration';
import TalkToData from './components/DataAssistant/TalkToData';

function App() {
  const [activeTab, setActiveTab] = useState('dataGeneration');

  return (
    <div className="app">
      <nav className="navbar">
        <h1>Data Assistant</h1>
      </nav>
      <div className="container">
        <aside className="sidebar">
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
              activeTab === 'talkToData' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('talkToData')}>
            <i className="fas fa-comment"></i> Talk to your data
          </button>
        </aside>
        <main className="content">
          {activeTab === 'dataGeneration' && <DataGeneration />}
          {activeTab === 'talkToData' && <TalkToData />}
        </main>
      </div>
    </div>
  );
}

export default App;
// import { useState } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from '/vite.svg'
// import './App.css'

// function App() {
//   const [count, setCount] = useState(0)

//   return (
//     <>
//       <div>
//         <a href="https://vite.dev" target="_blank">
//           <img src={viteLogo} className="logo" alt="Vite logo" />
//         </a>
//         <a href="https://react.dev" target="_blank">
//           <img src={reactLogo} className="logo react" alt="React logo" />
//         </a>
//       </div>
//       <h1>Vite + React</h1>
//       <div className="card">
//         <button onClick={() => setCount((count) => count + 1)}>
//           count is {count}
//         </button>
//         <p>
//           Edit <code>src/App.tsx</code> and save to test HMR
//         </p>
//       </div>
//       <p className="read-the-docs">
//         Click on the Vite and React logos to learn more
//       </p>
//     </>
//   )
// }

// export default App
