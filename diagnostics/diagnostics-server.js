import express from 'express';
import cors from 'cors';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(cors());

// Create a log file with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(__dirname, `diagnostics-log-${timestamp}.log`);

function logToFile(data) {
  const entry = JSON.stringify(data) + '\n';
  fs.appendFileSync(logFile, entry, 'utf8');
}

// IP endpoint - returns client's IP
app.get('/api/my-ip', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  res.json({ ip });
});

// Diagnostics endpoint - receives and logs diagnostics
app.post('/api/diagnostics', (req, res) => {
  const entry = {
    timestamp: new Date().toISOString(),
    ...req.body
  };
  console.log('[Backend] Diagnostics received:', entry);
  logToFile(entry);
  res.json({ status: 'ok' });
});

app.listen(3000, () => {
  console.log('Diagnostics server running on http://localhost:3000');
  console.log(`Diagnostics logging to: ${logFile}`);
});