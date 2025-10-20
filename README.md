# AI-Powered Synthetic Data Generator & Query Assistant

A full-stack conversational AI application that generates realistic synthetic data from SQL schemas and enables natural language querying of the generated datasets.

## 🎯 What It Is

This project is a practice implementation of a two-phase AI system:

1. **Synthetic Data Generation**: Upload a SQL DDL schema, and the system generates realistic, constraint-compliant data using Google's Gemini AI
2. **Talk to Your Data**: Query generated datasets using natural language, with automatic SQL generation, execution, and conversational responses

Built as a learning project to demonstrate proficiency in modern full-stack development, AI integration, and real-time web applications.

---

## ✨ Key Features

### Phase 1: Data Generation

- 📄 **DDL Schema Parsing** - Supports `.sql`, `.ddl`, and `.txt` files with CREATE TABLE statements
- 🤖 **AI-Powered Generation** - Uses Gemini 2.0 Flash to generate realistic data (names, addresses, dates, etc.)
- 🔗 **Constraint Handling** - Maintains data integrity (Primary Keys, Foreign Keys, NOT NULL, data types)
- ⚡ **Real-time Streaming** - Watch data appear table-by-table via WebSocket (Socket.IO)
- 🔧 **Data Modification** - Refine generated data using natural language prompts
- 💾 **Data Persistence** - All datasets saved to PostgreSQL for later querying
- 📦 **Export** - Download datasets as CSV or ZIP archives
- 🎚️ **Configurable Generation** - Adjust temperature, token limits, and per-table row counts
- 🛡️ **Integrity Repair** - Optional post-generation cleanup of FK/PK violations
- 📊 **Validation Reports** - Detailed summaries of data quality (duplicates, violations, coverage)

### Phase 2: Natural Language Querying

- 💬 **Conversational Interface** - Chat with your data using plain English
- 🧠 **Smart SQL Generation** - Gemini converts questions to SQL automatically
- 🔒 **Safe Execution** - Queries run in isolated PostgreSQL temp tables (read-only)
- 📋 **Transparent Results** - View AI answer, generated SQL, and raw table data
- 🛡️ **Security Guardrails**:
  - Prompt injection detection
  - Topic enforcement (data-related queries only)
  - SQL validation (SELECT-only, no destructive operations)
- 📈 **Observable** - Full tracing via Langfuse (prompts, responses, errors, latency)
- 🔍 **Schema-Aware** - Uses actual column names from generated data (not just DDL)

---

## 🏗️ Technology Stack

| Layer             | Technology                   | Purpose                                 |
| ----------------- | ---------------------------- | --------------------------------------- |
| **Frontend**      | React 19 + TypeScript + Vite | Modern UI with type safety              |
| **Backend**       | Node.js + Express            | REST API and WebSocket server           |
| **Database**      | PostgreSQL                   | Data persistence and querying           |
| **AI Model**      | Google Gemini 2.0 Flash      | Data generation and SQL generation      |
| **Real-time**     | Socket.IO                    | Live progress updates during generation |
| **Observability** | Langfuse                     | AI operation tracing and monitoring     |
| **Build Tools**   | npm, Vite                    | Package management and bundling         |

### Why These Choices?

- **React over Streamlit/Gradio**: Better control, professional UI, WebSocket support, scalability
- **PostgreSQL**: Robust relational DB with JSONB support for flexible storage
- **Socket.IO**: Reliable bi-directional communication for real-time progress
- **Gemini 2.0 Flash**: Fast, cost-effective, excellent at structured JSON output

---

## 📁 Project Structure

```
Practice1/
├── client/                  # React TypeScript frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── DataAssistant/      # Data generation UI
│   │   │   │   ├── DataGeneration.tsx
│   │   │   │   ├── TalkToYourData.tsx  # Phase 2 chat interface
│   │   │   │   └── ChatWithAI.tsx      # General AI chat
│   │   │   ├── DataPreview/        # Result display
│   │   │   │   ├── DataPreview.tsx     # Real-time data viewer
│   │   │   │   └── DataTable.tsx       # Table renderer
│   │   │   ├── DatasetList/        # Dataset management
│   │   │   └── Form/               # Input components
│   │   ├── App.tsx              # Main app with routing
│   │   └── main.tsx             # Entry point
│   └── package.json
│
├── server/                  # Node.js Express backend
│   ├── src/
│   │   ├── lib/
│   │   │   ├── dataGenerator.js      # Core data generation engine
│   │   │   ├── generationService.js  # Job orchestration
│   │   │   ├── queryService.js       # Phase 2 NL → SQL → Results
│   │   │   ├── chatService.js        # General AI chat
│   │   │   ├── monitoring.js         # Langfuse integration
│   │   │   ├── database.js           # PostgreSQL connection
│   │   │   └── schemaParser.js       # DDL parsing
│   │   ├── middleware/
│   │   └── index.js             # Express server + Socket.IO
│   ├── migrations/              # Database schema migrations
│   └── package.json
│
├── assets/                  # Sample DDL schemas
│   ├── library_mgm_schema.ddl
│   ├── restrurants_schema.ddl
│   └── company_employee_schema.ddl
│
└── README.md                # This file
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 14+ running locally or remotely
- **Google Cloud** account with Gemini API access
- **Langfuse** account (optional, for observability)

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd Practice1
```

### 2. Install and Set Up PostgreSQL

#### Installing PostgreSQL

**macOS (using Homebrew):**

```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL service
brew services start postgresql@14

# Verify it's running
psql --version
```

**macOS (using Postgres.app):**

1. Download from [https://postgresapp.com/](https://postgresapp.com/)
2. Move to Applications folder
3. Open Postgres.app
4. Click "Initialize" to create a new server

**Linux (Ubuntu/Debian):**

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify it's running
sudo systemctl status postgresql
```

**Windows:**

1. Download from [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/)
2. Run the installer
3. Remember the password you set for the postgres user
4. PostgreSQL service starts automatically

#### Create Database

**For macOS/Linux:**

```bash
# Connect to PostgreSQL
psql postgres

# Or if you need to specify user
psql -U postgres

# Create the database
CREATE DATABASE synthetic_data;

# Verify it was created
\l

# Exit
\q
```

**For Windows (using pgAdmin or psql):**

```bash
# Open Command Prompt/PowerShell
psql -U postgres

# Create database
CREATE DATABASE synthetic_data;

# Exit
\q
```

#### Verify Connection

Test your database connection:

```bash
psql -d synthetic_data -U postgres

# Or use your custom username
psql -d synthetic_data -U yourusername
```

If you see the `synthetic_data=#` prompt, you're connected successfully!

#### Troubleshooting

**Connection refused errors:**

- Make sure PostgreSQL is running: `brew services list` (macOS) or `sudo systemctl status postgresql` (Linux)
- Check if port 5432 is available: `lsof -i :5432` (macOS/Linux) or `netstat -an | findstr 5432` (Windows)

**Authentication errors:**

- If using default setup on macOS, you might not need a password
- On Linux, you may need to edit `/etc/postgresql/14/main/pg_hba.conf` to allow password authentication
- Use `peer` authentication for local connections or set a password:
  ```sql
  ALTER USER postgres PASSWORD 'yourpassword';
  ```

**Database doesn't exist:**

- Make sure you ran `CREATE DATABASE synthetic_data;`
- Check existing databases: `\l` in psql

### 3. Configure Environment Variables

Create `server/.env` file:

```bash
cd server
cp env.example.txt .env
```

Edit `server/.env` with your credentials:

```env
# Required
GEMINI_API_KEY=your_gemini_api_key_here

# DATABASE_URL format: postgresql://username:password@host:port/database
# Examples based on your setup:

# macOS (Homebrew) - usually no password needed
DATABASE_URL=postgresql://yourusername@localhost:5432/synthetic_data

# macOS (Postgres.app) - usually no password needed
DATABASE_URL=postgresql://yourusername@localhost:5432/synthetic_data

# Linux - default postgres user
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/synthetic_data

# Windows - with password you set during installation
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/synthetic_data

# Generic format (replace with your values)
# DATABASE_URL=postgresql://username:password@localhost:5432/synthetic_data

# Optional (defaults shown)
PORT=4000
NODE_ENV=development
GOOGLE_GENAI_MODEL=gemini-2.0-flash-001

# Langfuse (optional observability)
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

**Finding your PostgreSQL username:**

- macOS: Usually your macOS username (check with `whoami` in terminal)
- Linux: Default is `postgres`
- Windows: Default is `postgres`

**If you don't have a password set:**

- Omit the password: `postgresql://username@localhost:5432/synthetic_data`
- Or set one: `ALTER USER yourusername PASSWORD 'newpassword';` in psql

**Getting Gemini API Key:**

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Copy and paste into `.env`

**Getting Langfuse Keys (optional):**

1. Sign up at [Langfuse Cloud](https://cloud.langfuse.com)
2. Create a project
3. Copy public and secret keys from settings

### 4. Install Dependencies

**Backend:**

```bash
cd server
npm install
```

**Frontend:**

```bash
cd ../client
npm install
```

### 5. Run Database Migrations

```bash
cd ../server
npm run migrate
```

Expected output:

```
✓ Migration: 001_initial_schema.sql
Migrations applied: 1
```

### 6. Start the Application

**Terminal 1 - Backend:**

```bash
cd server
npm run dev
```

You should see:

```
[Langfuse] Initialized successfully
Database setup completed
Server running on port 4000
```

**Terminal 2 - Frontend:**

```bash
cd client
npm run dev
```

You should see:

```
VITE v7.1.8  ready in 423 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

### 7. Open the Application

Navigate to **http://localhost:5173** in your browser.

---

## 📖 Usage Guide

### Generating Synthetic Data

1. **Upload DDL Schema**

   - Click "Data Generation" in the sidebar
   - Drag & drop a `.ddl` file or click to browse
   - Sample schemas are in `/assets/` folder

2. **Configure Generation (Optional)**

   - Add custom instructions (e.g., "Make all authors famous historical figures")
   - Adjust temperature (0.0 = deterministic, 1.0 = creative)
   - Set max tokens (higher = more detailed data)
   - Specify target rows per table

3. **Generate**

   - Click "Generate" button
   - Watch real-time progress (parsing → generating → validating → saving)
   - Data appears dynamically as each table completes

4. **Review & Modify**

   - Browse generated tables in the preview panel
   - Use "Quick Edit" to refine data with prompts
   - Export as CSV or ZIP

5. **Query Your Data**
   - Generated datasets appear in the left sidebar
   - Click to select, then go to "Talk to your data" tab

### Querying Data with Natural Language

1. **Select Dataset**

   - Choose a generated dataset from the dropdown

2. **Ask Questions**

   - Type natural language queries:
     - "Show me all authors and their books"
     - "What are the top 5 highest-paid employees?"
     - "Summarize the biography of Isaac Asimov"
     - "How many orders were placed in 2023?"

3. **View Results**

   - **AI Answer**: Conversational response based on data
   - **SQL Query**: Generated SQL for transparency
   - **Table**: Raw query results (first 10 rows)

4. **Chat History**
   - All questions and answers persist in the session
   - Scroll to review previous queries

---

## 🎓 Implementation Details

### Data Generation Flow

1. **Schema Parsing**: DDL → Internal table/column model (data types, constraints, relationships)
2. **Dependency Resolution**: Topological sort ensures parent tables generate before children
3. **AI Generation**: Per-table prompts to Gemini with schema context
4. **Validation**: Check for PK duplicates, FK violations, NOT NULL issues
5. **Integrity Repair (optional)**: Fix violations by adjusting values
6. **Persistence**: Save to PostgreSQL with metadata

### Query Flow (Talk to Your Data)

1. **Guardrails**: Check for prompt injection, off-topic questions
2. **Schema Fetch**: Get actual column names from generated data
3. **SQL Generation**: Gemini converts question → SQL using actual schema
4. **Execution**: Create temp tables, run SELECT query, rollback
5. **Answer Generation**: Gemini creates natural language response from results
6. **Response**: Return answer + SQL + table data to UI

### Key Design Decisions

- **Column Name Normalization**: Lowercase all columns to avoid PostgreSQL case issues
- **Temp Tables for Safety**: Queries never touch real data, use isolated temp tables
- **Actual Schema vs DDL**: Use generated data's column names (not DDL) to handle AI variations
- **Chunked Delivery**: Emit data in chunks for perceived responsiveness
- **Langfuse Spans**: Track each step (parse, generate, validate, modify) separately

---

## 📊 Phase Completion Status

| Phase                                  | Status          | Notes                                                         |
| -------------------------------------- | --------------- | ------------------------------------------------------------- |
| **Phase 1: Data Generation**           | ✅ Complete     | All features implemented except Docker (company restrictions) |
| **Phase 2: Natural Language Querying** | ⚠️ 90% Complete | Missing: Data visualizations (charts/plots)                   |
| **Phase 3: Advanced Features**         | ⏳ Not Started  | TBD                                                           |

### Phase 1 Features

| Feature                     | Status                              |
| --------------------------- | ----------------------------------- |
| DDL parsing                 | ✅                                  |
| AI data generation          | ✅                                  |
| Constraint handling (PK/FK) | ✅                                  |
| Real-time streaming         | ✅                                  |
| Data validation             | ✅                                  |
| Data modification           | ✅                                  |
| Export (CSV/ZIP)            | ✅                                  |
| Persistence                 | ✅                                  |
| Langfuse tracing            | ✅                                  |
| Docker containerization     | ❌ (Skipped - company restrictions) |

### Phase 2 Features

| Feature                    | Status        |
| -------------------------- | ------------- |
| Conversational interface   | ✅            |
| Natural language → SQL     | ✅            |
| Safe query execution       | ✅            |
| Conversational answers     | ✅            |
| SQL + table display        | ✅            |
| Prompt injection detection | ✅            |
| Topic enforcement          | ✅            |
| Langfuse tracing           | ✅            |
| Data visualizations        | ❌ (Pending)  |
| PII masking                | ⏳ (Optional) |

---

## 🔧 Configuration Options

### Data Generation

| Parameter           | Default | Description                 |
| ------------------- | ------- | --------------------------- |
| `temperature`       | 0.7     | AI creativity (0.0-1.0)     |
| `maxTokens`         | 500     | Response length limit       |
| `targetRows`        | 10      | Global row count (advisory) |
| `integrityRepair`   | false   | Auto-fix PK/FK violations   |
| `seed`              | -       | Deterministic mode          |
| `perTableRowCounts` | -       | Override rows per table     |

### Environment Variables

| Variable              | Required | Default                    | Description                  |
| --------------------- | -------- | -------------------------- | ---------------------------- |
| `GEMINI_API_KEY`      | ✅       | -                          | Google AI API key            |
| `DATABASE_URL`        | ✅       | -                          | PostgreSQL connection string |
| `PORT`                | ❌       | 4000                       | Server port                  |
| `NODE_ENV`            | ❌       | development                | Environment mode             |
| `GOOGLE_GENAI_MODEL`  | ❌       | gemini-2.0-flash-001       | Model version                |
| `USE_AI`              | ❌       | true                       | Enable/disable AI            |
| `DEBUG_DATA_GEN`      | ❌       | false                      | Verbose logging              |
| `LANGFUSE_ENABLED`    | ❌       | false                      | Observability tracking       |
| `LANGFUSE_PUBLIC_KEY` | ❌       | -                          | Langfuse public key          |
| `LANGFUSE_SECRET_KEY` | ❌       | -                          | Langfuse secret key          |
| `LANGFUSE_HOST`       | ❌       | https://cloud.langfuse.com | Langfuse endpoint            |

---

## 🐛 Known Issues & Limitations

1. **Column Name Variations**: Gemini may generate different column names than DDL (e.g., `company_name` vs `name`). System handles this by using actual data schema.

2. **Row Count Advisory**: Requested row counts are hints; Gemini may generate fewer/more based on context and token limits.

3. **FK Violations in Raw Mode**: Without integrity repair, Gemini may create invalid foreign key references. Enable "Integrity Repair" toggle to fix.

4. **No Streaming from Gemini**: Current implementation generates full tables, then emits chunks. True token-by-token streaming is complex with JSON parsing.

5. **No Visualizations**: Phase 2 missing chart generation (bar, line, pie charts for numerical data).

---

## 🛣️ Future Enhancements

- [ ] **Data Visualizations**: Auto-generate charts for numerical queries
- [ ] **PII Masking**: Tokenize sensitive data in queries
- [ ] **Query Modification**: Edit SQL before execution
- [ ] **Dataset Comparison**: Diff tool for modified datasets
- [ ] **True Gemini Streaming**: Token-by-token response streaming
- [ ] **Multi-dataset Joins**: Query across multiple datasets
- [ ] **Export Query Results**: Download query results as CSV
- [ ] **Scheduled Regeneration**: Cron jobs for dataset refresh
- [ ] **User Authentication**: Multi-user support with access control
- [ ] **Cloud Deployment**: Containerized deployment to AWS/GCP/Azure

---

## 🧪 Testing

Run backend tests:

```bash
cd server
npm test
```

Check database migrations:

```bash
npm run check:migrations
```

---

## 🗄️ PostgreSQL Quick Reference

### Common Commands

**Start/Stop PostgreSQL:**

```bash
# macOS (Homebrew)
brew services start postgresql@14
brew services stop postgresql@14
brew services restart postgresql@14

# Linux
sudo systemctl start postgresql
sudo systemctl stop postgresql
sudo systemctl restart postgresql

# Check status
brew services list  # macOS
sudo systemctl status postgresql  # Linux
```

**Connect to Database:**

```bash
# Connect to specific database
psql -d synthetic_data

# Connect as specific user
psql -U postgres -d synthetic_data

# Connect with password prompt
psql -U postgres -d synthetic_data -W
```

**Useful psql Commands:**

```sql
\l              -- List all databases
\c dbname       -- Connect to database
\dt             -- List tables in current database
\d table_name   -- Describe table structure
\du             -- List users/roles
\q              -- Quit psql
```

**Database Management:**

```sql
-- Create database
CREATE DATABASE synthetic_data;

-- Drop database (careful!)
DROP DATABASE synthetic_data;

-- Create user
CREATE USER myuser WITH PASSWORD 'mypassword';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE synthetic_data TO myuser;

-- Change password
ALTER USER postgres PASSWORD 'newpassword';
```

**View Generated Data:**

```sql
-- Connect to your database
psql -d synthetic_data

-- List all datasets
SELECT id, name, created_at FROM generated_datasets ORDER BY created_at DESC;

-- View data for a specific table
SELECT * FROM generated_data WHERE dataset_id = 1 AND table_name = 'Authors' LIMIT 10;

-- Count rows per table in a dataset
SELECT table_name, COUNT(*) as row_count
FROM generated_data
WHERE dataset_id = 1
GROUP BY table_name;
```

---

## 📚 Additional Documentation

- **API Reference**: `server/docs/API.md` - Full REST and WebSocket API documentation
- **Sample Schemas**: `assets/*.ddl` - Example DDL files to test with
- **Phase Requirements**: `Phase2-to-do.txt` - Original project specifications
