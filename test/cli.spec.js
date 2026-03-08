/**
 * CLI startup tests - help, port validation, EADDRINUSE handling, auto-retry.
 * Run: node test/cli.spec.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const TEST_TMP = path.join(__dirname, '.tmp');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'smart-log-viewer.js');
const TEST_PORT = 3870;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCli(args = [], env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runCliBackground(args = [], env = {}) {
  const proc = spawn('node', [CLI_PATH, ...args], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return proc;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  function ok(cond, name) {
    if (cond) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
      failures.push(name);
    }
  }

  console.log('\n=== CLI Startup Tests ===\n');

  // --- Help ---
  console.log('--- Help ---');
  const help_res = await runCli(['--help']);
  ok(help_res.code === 0, '--help exits 0');
  ok(help_res.stdout.includes('Smart Log Viewer'), 'Help shows title');
  ok(help_res.stdout.includes('--port'), 'Help shows --port option');
  ok(help_res.stdout.includes('--no-open'), 'Help shows --no-open option');

  const help_h = await runCli(['-h']);
  ok(help_h.code === 0, '-h exits 0');
  ok(help_h.stdout.includes('Smart Log Viewer'), '-h shows help');

  // --- Invalid port ---
  console.log('\n--- Invalid port ---');
  const bad_port = await runCli(['--port', '99999']);
  ok(bad_port.code !== 0, 'Invalid port (99999) exits non-zero');
  ok(bad_port.stderr.includes('Invalid port') || bad_port.stdout.includes('Invalid port'),
    'Invalid port shows error message');

  const bad_port_2 = await runCli(['--port', '0']);
  ok(bad_port_2.code !== 0, 'Port 0 exits non-zero');

  const bad_port_3 = await runCli(['--port', 'abc']);
  ok(bad_port_3.code !== 0, 'Invalid port (abc) exits non-zero');

  // --- Successful start ---
  console.log('\n--- Successful start ---');
  const proc = runCliBackground(['--port', String(TEST_PORT), '--no-open']);
  await sleep(3000);
  let server_up = false;
  try {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/config`);
    server_up = res.status === 200;
  } catch (_) {}
  ok(server_up, 'CLI starts server on specified port');
  proc.kill('SIGTERM');
  await sleep(800);

  // --- EADDRINUSE: user-specified port ---
  console.log('\n--- EADDRINUSE (user-specified port) ---');
  const conflict_port = TEST_PORT + 1;
  const block_proc = runCliBackground(['--port', String(conflict_port), '--no-open']);
  await sleep(3000);
  const conflict_res = await runCli(['--port', String(conflict_port), '--no-open']);
  block_proc.kill('SIGTERM');
  await sleep(500);
  ok(conflict_res.code !== 0, 'EADDRINUSE exits non-zero');

  const conflict_out = conflict_res.stderr + conflict_res.stdout;
  const has_suggestion = conflict_out.includes('--port') || conflict_out.includes('already in use');
  ok(has_suggestion, 'EADDRINUSE shows actionable message (--port or already in use)');

  // --- Auto-retry when default port in use ---
  console.log('\n--- Auto-retry (default port in use) ---');
  const retry_block_port = 3890;
  const block_default = runCliBackground(['--no-open'], { PORT: String(retry_block_port) });
  for (let i = 0; i < 15; i++) {
    try {
      await httpGet(`http://localhost:${retry_block_port}/api/config`);
      break;
    } catch (_) {
      await sleep(300);
    }
  }

  const retry_env = {
    ...process.env,
    CONFIG_DIR: path.join(TEST_TMP, 'cli_config'),
    PORT: String(retry_block_port),
  };
  const retry_proc = runCliBackground(['--no-open'], retry_env);
  await sleep(6000);
  let retry_succeeded = false;
  for (const p of [retry_block_port + 1, retry_block_port + 2, retry_block_port + 3]) {
    try {
      const r = await httpGet(`http://localhost:${p}/api/config`);
      if (r.status === 200) { retry_succeeded = true; break; }
    } catch (_) {}
  }
  retry_proc.kill('SIGTERM');
  block_default.kill('SIGTERM');
  await sleep(800);
  ok(retry_succeeded, 'Auto-retry attempts next port or succeeds');

  // --- Config dir ---
  console.log('\n--- Config dir ---');
  const config_port = TEST_PORT + 2;
  const fresh_config_path = path.join(TEST_TMP, 'config_fresh_' + Date.now());
  const config_proc = runCliBackground(['--port', String(config_port), '--config', fresh_config_path, '--no-open']);
  await sleep(3000);
  let config_ok = false;
  try {
    const cfg_res = await httpGet(`http://localhost:${config_port}/api/config`);
    config_ok = cfg_res.status === 200;
  } catch (_) {}
  config_proc.kill('SIGTERM');
  await sleep(800);
  ok(config_ok, '--config uses custom config directory');

  if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('CLI test failed:', err);
  process.exit(1);
});
