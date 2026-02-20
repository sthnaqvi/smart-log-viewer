/**
 * End-to-end tests for Smart Log Viewer.
 * Spawns server, tests API + WebSocket, then exits.
 * Run: npm test (after npm install)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const PORT = 3848;
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;

let server_process = null;
let temp_log_path = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(opts, (res) => {
      let out = '';
      res.on('data', (chunk) => (out += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(out) });
        } catch {
          resolve({ status: res.statusCode, body: out });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const TEST_CONFIG_DIR = path.join(__dirname, '..', '.test_config');

function startServer() {
  return new Promise((resolve) => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    server_process = spawn('node', ['server/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        CONFIG_DIR: TEST_CONFIG_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const check = async () => {
      if (started) return;
      try {
        await httpGet(`${BASE_URL}/api/config`);
        started = true;
        resolve();
      } catch {
        await sleep(100);
        check();
      }
    };
    server_process.stderr.on('data', (d) => {
      if (!started && String(d).includes('running')) started = true;
    });
    setTimeout(check, 50);
  });
}

function stopServer() {
  if (server_process) {
    server_process.kill('SIGTERM');
    server_process = null;
  }
}

function createTempLog() {
  temp_log_path = path.join(__dirname, '..', 'test_log_' + Date.now() + '.log');
  fs.writeFileSync(temp_log_path, '');
  return temp_log_path;
}

function appendToLog(lines) {
  fs.appendFileSync(temp_log_path, lines + '\n');
}

function cleanupTempLog() {
  if (temp_log_path && fs.existsSync(temp_log_path)) {
    fs.unlinkSync(temp_log_path);
    temp_log_path = null;
  }
}

async function wsConnectAndSelect(file_path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const received = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'select', file_path }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        if (msg.type === 'buffer') {
          resolve({ ws, received });
        }
      } catch (_) {}
    });
    ws.on('error', reject);
    setTimeout(() => {
      if (received.length) resolve({ ws, received });
      else reject(new Error('No buffer received'));
    }, 3000);
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function ok(cond, name) {
    if (cond) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  console.log('\n--- Smart Log Viewer E2E Tests ---\n');

  try {
    await startServer();
    await sleep(200);
    ok(true, 'Server started');

    const { status, body } = await httpGet(`${BASE_URL}/api/config`);
    ok(status === 200, 'GET /api/config returns 200');
    ok(Array.isArray(body.file_paths), 'Config has file_paths array');

    const log_path = createTempLog();
    appendToLog('{"ts":"2026-02-18","lv":"INFO","msg":"test line 1","fl":"test.js","ln":1}');

    const add_res = await httpPost(`${BASE_URL}/api/config/add`, { path: log_path });
    ok(add_res.status === 200, 'POST /api/config/add returns 200');
    ok(!add_res.body.error, 'Add success has no error field (modal would close)');
    ok(add_res.body.file_paths && add_res.body.file_paths.includes(log_path), 'Path added to config');

    const add_dup = await httpPost(`${BASE_URL}/api/config/add`, { path: log_path });
    ok(add_dup.status === 200, 'Add duplicate path returns 200 (modal would close)');

    await sleep(300);

    const { ws, received } = await wsConnectAndSelect(log_path);
    const buffer_msg = received.find((m) => m.type === 'buffer');
    ok(!!buffer_msg, 'WebSocket receives buffer on select');
    ok(Array.isArray(buffer_msg.entries), 'Buffer has entries array');
    ok(buffer_msg.entries.length >= 1, 'Buffer contains initial log line');
    const has_test_msg = buffer_msg.entries.some((e) => e.msg === 'test line 1');
    ok(has_test_msg, 'Buffer contains expected log entry');

    const log_promise = new Promise((resolve) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'log' && msg.entry && msg.entry.msg === 'streaming test') {
            resolve(true);
          }
        } catch (_) {}
      });
    });

    appendToLog('{"ts":"2026-02-18","lv":"ERROR","msg":"streaming test","fl":"e2e.js","ln":99}');
    const got_stream = await Promise.race([log_promise, sleep(2000).then(() => false)]);
    ok(got_stream, 'WebSocket receives new log in real-time');

    ws.close();

    const remove_res = await httpPost(`${BASE_URL}/api/config/remove`, { path: log_path });
    ok(remove_res.status === 200, 'POST /api/config/remove returns 200');
    ok(!remove_res.body.file_paths.includes(log_path), 'Path removed from config');

    const invalid_add = await httpPost(`${BASE_URL}/api/config/add`, {
      path: '/nonexistent/path/12345.log',
    });
    ok(invalid_add.status === 400, 'Add invalid path returns 400');

    const no_path_add = await httpPost(`${BASE_URL}/api/config/add`, {});
    ok(no_path_add.status === 400, 'Add without path returns 400');
  } finally {
    stopServer();
    cleanupTempLog();
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    await sleep(100);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  stopServer();
  cleanupTempLog();
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
  }
  process.exit(1);
});
