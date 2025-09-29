require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const { setupDatabase } = require('./lib/database');
const { initializeLangfuse } = require('./lib/monitoring');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin:
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : 'https://your-production-domain.com',
    methods: ['GET', 'POST'],
  },
});

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    if (ext !== '.sql' && ext !== '.ddl' && ext !== '.txt') {
      return cb(new Error('Only SQL, DDL, and TXT files are allowed'));
    }
    cb(null, true);
  },
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

// Initialize services
setupDatabase();
initializeLangfuse();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('generateData', async (data) => {
    try {
      // Handle data generation with streaming updates
      // Implementation will go here
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// API Routes
app.post('/api/upload', upload.single('schema'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Handle the uploaded file
  res.json({ message: 'File uploaded successfully' });
});

app.get('/api/datasets', async (req, res) => {
  // Return list of generated datasets
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
