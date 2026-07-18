// StadiumPulse AI — Server Entry Point
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

// Import modular services and routers
import apiRouter, { pageAuth } from './routes/api.js';
import { runSensorSimulationStep } from './services/simulator.js';
import { db } from './services/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Serve login route (accessible publicly)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Mount modular API routes
app.use('/api', apiRouter);

// Serve frontend role-based pages (Protected)
app.get('/operations', pageAuth('ops'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'operations.html'));
});

app.get('/volunteer', pageAuth('volunteer'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'volunteer.html'));
});

app.get('/dev', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dev.html'));
});

// Default root serves the Launcher Gateway
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/fan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fan.html'));
});

// Start the background stadium crowd telemetry simulation step (runs every 10 seconds)
setInterval(runSensorSimulationStep, 10000);

// Initialize storage schema before listening
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`StadiumPulse AI Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Critical: Storage engine startup failure:", err);
  process.exit(1);
});

export default app;
