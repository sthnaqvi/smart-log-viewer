const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const configManager = require('./configManager');
const { TailManager } = require('./tailManager');

const DEFAULT_PORT = 3847;

function getPort() {
  return parseInt(process.env.PORT || String(DEFAULT_PORT), 10) || DEFAULT_PORT;
}
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

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'select' && msg.file_path) {
        const normalized = path.normalize(msg.file_path);
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
    const sources = await configManager.getSources();
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/add', async (req, res) => {
  try {
    const { path: file_path, tagName, color } = req.body;
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
    const sources = await configManager.addSource(normalized, tagName, color);
    tail_manager.startTail(normalized);
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/update', async (req, res) => {
  try {
    const { path: file_path, tagName, color } = req.body;
    if (!file_path || typeof file_path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    const sources = await configManager.updateSource(file_path, { tagName, color });
    res.json({ sources });
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
    const sources = await configManager.removeSource(normalized);
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  try {
    const sources = await configManager.getSources();
    for (const s of sources) {
      try {
        fs.accessSync(s.path, fs.constants.R_OK);
        tail_manager.startTail(s.path);
      } catch (_) {
        // Skip invalid paths, don't crash
      }
    }
  } catch (_) {
    // Config may not exist yet
  }

  return new Promise((resolve, reject) => {
    const port = getPort();
    const server = app.listen(port, () => {
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
      const close_all = () => {
        for (const ws of clients) {
          try { ws.terminate(); } catch (_) {}
        }
      };
      resolve({ server, tail_manager, close_all });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  process.env.PORT = process.env.PORT || '3847';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || require('path').join(require('os').homedir(), '.smart-log-viewer');
  startServer()
    .then(({ server, tail_manager, close_all }) => {
      console.log(`Smart Log Viewer running at http://localhost:${getPort()}`);
      const shutdown = () => {
        tail_manager.stopAll();
        if (close_all) close_all();
        server.close(() => process.exit(0));
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
} else {
  module.exports = { startServer };
}
