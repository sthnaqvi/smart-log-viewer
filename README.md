# Smart Log Viewer

A production-quality real-time structured log viewer for developers. Stream local log files to a browser UI with zero heavy frameworks—just Node.js, Express, WebSocket, and vanilla JavaScript.

## What Problem This Solves

Developers often need to:

- Tail multiple log files simultaneously
- Parse structured JSON logs (e.g. Pino, Winston)
- Filter by level and search text
- Avoid loading huge files into memory
- Keep a persistent list of watched files

Smart Log Viewer addresses this with a lightweight, stable tool that uses `tail -F` for streaming and WebSockets for real-time updates.

## Features

- **File path selector** – Add, remove, and switch between log files
- **Persistence** – Paths saved to `~/.smart-log-viewer/config.json`
- **Real-time streaming** – WebSocket-based, no polling
- **Structured JSON parsing** – Parses JSON logs safely; malformed lines are ignored
- **Dark theme UI** – Sidebar, topbar filters, log table
- **Level colors** – ERROR (red), WARN (amber), INFO (blue)
- **Filters** – Level dropdown, text search, pause, clear
- **Click row** – Pretty JSON modal
- **Performance** – 2000-row cap to prevent browser slowdown
- **Bonus** – Auto-scroll toggle, copy log, download visible logs

## Install

```bash
git clone <repo>
cd smart-log-viewer
npm install
```

## Run

```bash
npm test    # Run API + UI e2e tests first (recommended)
npm start
```

Open http://localhost:3847

## Tests

- `npm test` - Runs API tests + full UI tests (Playwright)
- `npm run test:api` - API/WebSocket tests only
- `npm run test:ui` - Browser UI tests only (requires `npx playwright install chromium` once)

## Development

```bash
npm run dev
```

Uses `--watch` for auto-restart on file changes.

## Persistence

Chosen file paths are stored in:

```
~/.smart-log-viewer/config.json
```

Format:

```json
{
  "file_paths": [
    "/var/log/app.log",
    "/tmp/debug.log"
  ]
}
```

- Config is auto-created if missing
- Paths are loaded on server start
- No database; plain JSON only

## Run with PM2

```bash
pm2 start server/server.js --name smart-log-viewer
```

Or with a custom port:

```bash
PORT=9000 pm2 start server/server.js --name smart-log-viewer
```

## Architecture

```
/server
  server.js       - Express, WebSocket, API routes
  tailManager.js  - tail -F, multi-file, broadcast
  configManager.js - read/write ~/.smart-log-viewer/config.json

/public
  index.html
  app.js
  styles.css
```

## Stability

The server handles:

- Invalid file paths
- Deleted files
- File rotation (`tail -F` follows by name)
- Malformed JSON (ignored, no crash)

## Tech Stack

- Node.js
- Express
- ws (WebSocket)
- Vanilla JS frontend
- Modern CSS (no Bootstrap)
