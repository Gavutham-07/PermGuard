import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { BurpBridge } from './src/engine/BurpBridge';
import { ImportedFinding } from './src/types';

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '1mb' }));

// In-memory findings & token cache on the server
let serverStoredFindings: ImportedFinding[] = [];
let activePairingToken = process.env.PERMGUARD_PAIRING_TOKEN || '';

if (!activePairingToken) {
  // Generate secure default token
  const randomBytes = Array.from({ length: 24 }, () => Math.floor(Math.random() * 256));
  activePairingToken = 'pg_sec_' + randomBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Health Check API ──
app.get('/api/burp/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'PermGuard Local Bridge',
    listening: true,
    port: PORT,
    eventsReceived: serverStoredFindings.length,
    timestamp: new Date().toISOString(),
  });
});

// ── Token Management Endpoint ──
app.get('/api/burp/token', (req, res) => {
  res.json({
    token: activePairingToken,
  });
});

app.post('/api/burp/token/rotate', (req, res) => {
  const randomBytes = Array.from({ length: 24 }, () => Math.floor(Math.random() * 256));
  activePairingToken = 'pg_sec_' + randomBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  res.json({
    token: activePairingToken,
    message: 'Pairing token rotated successfully.',
  });
});

// ── Burp Events Ingestion Endpoint ──
app.post('/api/burp/events', (req, res) => {
  const authHeader = req.headers.authorization;
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

  const result = BurpBridge.processIncomingEvent(
    req.body,
    authHeader,
    activePairingToken,
    serverStoredFindings,
    clientIp
  );

  if (result.statusCode === 201 && result.response.finding) {
    serverStoredFindings.unshift(result.response.finding);
  }

  res.status(result.statusCode).json(result.response);
});

// ── Sync Findings with Browser Client ──
app.get('/api/burp/events', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!BurpBridge.authenticate(authHeader, activePairingToken)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid pairing token' });
  }
  res.json({ findings: serverStoredFindings });
});

// ── Clear Findings ──
app.delete('/api/burp/events', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!BurpBridge.authenticate(authHeader, activePairingToken)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid pairing token' });
  }
  serverStoredFindings = [];
  res.json({ success: true, message: 'All bridge findings cleared.' });
});

// ── Mount Vite Dev Middleware ──
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, HOST, () => {
    console.log(`[PermGuard] Server listening at http://${HOST}:${PORT}`);
    console.log(`[PermGuard] Bridge Endpoint: http://127.0.0.1:${PORT}/api/burp/events`);
  });
}

startServer();
