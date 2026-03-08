/**
 * Tests the package as installed via npm (simulates global install).
 * Packs the package, installs to a temp prefix, runs the binary.
 * Run: node test/global-install.spec.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALL_PREFIX = path.join(__dirname, '.tmp', 'global_install');
const TEST_PORT = 3900;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd || PROJECT_ROOT,
      env: opts.env || process.env,
      stdio: opts.silent ? 'pipe' : 'inherit',
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    proc.on('error', reject);
  });
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd || PROJECT_ROOT,
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
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

  console.log('\n=== Global Install Tests ===\n');

  if (fs.existsSync(INSTALL_PREFIX)) {
    fs.rmSync(INSTALL_PREFIX, { recursive: true });
  }
  fs.mkdirSync(path.dirname(INSTALL_PREFIX), { recursive: true });

  let tarball_path = null;

  try {
    console.log('--- Pack package ---');
    const pack_res = await runCapture('npm', ['pack', '--silent'], { cwd: PROJECT_ROOT });
    const pack_out = (pack_res.stdout + pack_res.stderr).trim();
    const match = pack_out.match(/smart-log-viewer-\d+\.\d+\.\d+\.tgz/);
    if (!match) {
      const files = fs.readdirSync(PROJECT_ROOT).filter((f) => f.endsWith('.tgz'));
      tarball_path = files.length ? path.join(PROJECT_ROOT, files[0]) : null;
    } else {
      tarball_path = path.join(PROJECT_ROOT, match[0]);
    }
    ok(!!tarball_path && fs.existsSync(tarball_path), 'npm pack creates tarball');

    console.log('\n--- Install to temp prefix ---');
    await run('npm', ['install', '-g', '--prefix', INSTALL_PREFIX, tarball_path], { silent: true });
    const bin_path = path.join(INSTALL_PREFIX, 'bin', 'smart-log-viewer');
    ok(fs.existsSync(bin_path), 'Binary installed');

    console.log('\n--- Run installed binary ---');
    const help_res = await runCapture(bin_path, ['--help']);
    ok(help_res.code === 0, '--help exits 0');
    ok(help_res.stdout.includes('Smart Log Viewer'), 'Help shows title');

    const proc = spawn(bin_path, ['--port', String(TEST_PORT), '--no-open'], {
      env: { ...process.env, PATH: path.join(INSTALL_PREFIX, 'bin') + path.delimiter + process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await sleep(4000);
    let server_up = false;
    try {
      const res = await httpGet(`http://localhost:${TEST_PORT}/api/config`);
      server_up = res.status === 200;
    } catch (_) {}
    proc.kill('SIGTERM');
    await sleep(500);
    ok(server_up, 'Installed binary starts server');

  } finally {
    if (tarball_path && fs.existsSync(tarball_path)) {
      fs.unlinkSync(tarball_path);
    }
    if (fs.existsSync(INSTALL_PREFIX)) {
      fs.rmSync(INSTALL_PREFIX, { recursive: true });
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log('\nFailed:', failures.join(', '));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Global install test failed:', err);
  process.exit(1);
});
