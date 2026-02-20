const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const configManager = require('./configManager');
const { TailManager } = require('./tailManager');

const PORT = process.env.PORT || 3847;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const tail_manager = new TailManager();

function broadcastToClients(clients, message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch (_) {
        // Ignore send errors
      }
    }
  }
}

const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

tail_manager.setBroadcast(({ file_path, entry }) => {
  broadcastToClients(clients, { type: 'log', file_path, entry });
});

wss.on('connection', (ws, req) => {
  clients.add(ws);
  let selected_file = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'select' && msg.file_path) {
        const normalized = path.normalize(msg.file_path);
        selected_file = normalized;
        const buffer = tail_manager.getBuffer(normalized);
        ws.send(
          JSON.stringify({
            type: 'buffer',
            file_path: normalized,
            entries: buffer,
          })
        );
      }
    } catch (_) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

app.get('/api/config', async (req, res) => {
  try {
    const file_paths = await configManager.getFilePaths();
    res.json({ file_paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/add', async (req, res) => {
  try {
    const { path: file_path } = req.body;
    if (!file_path || typeof file_path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    const normalized = path.normalize(file_path.trim());
    try {
      fs.accessSync(normalized, fs.constants.R_OK);
    } catch (access_err) {
      return res.status(400).json({
        error: `File not readable or does not exist: ${access_err.message}`,
      });
    }
    const file_paths = await configManager.addFilePath(normalized);
    tail_manager.startTail(normalized);
    res.json({ file_paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/remove', async (req, res) => {
  try {
    const { path: file_path } = req.body;
    if (!file_path || typeof file_path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    const normalized = path.normalize(file_path.trim());
    tail_manager.stopTail(normalized);
    const file_paths = await configManager.removeFilePath(normalized);
    res.json({ file_paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  try {
    const file_paths = await configManager.getFilePaths();
    for (const fp of file_paths) {
      try {
        fs.accessSync(fp, fs.constants.R_OK);
        tail_manager.startTail(fp);
      } catch (_) {
        // Skip invalid paths, don't crash
      }
    }
  } catch (_) {
    // Config may not exist yet
  }

  const server = app.listen(PORT, () => {
    console.log(`Smart Log Viewer running at http://localhost:${PORT}`);
  });

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  process.on('SIGTERM', () => {
    tail_manager.stopAll();
    server.close();
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
