/**
 * UI End-to-End tests using Playwright.
 * Tests full user flow: add file, modal closes, logs display.
 * Run: npm run test:ui (after npm install)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3849;
const TEST_CONFIG_DIR = path.join(__dirname, '..', '.test_config');
let server_process = null;
let temp_log_path = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        const res = await fetch(`http://localhost:${PORT}/api/config`);
        if (res.ok) {
          started = true;
          resolve();
        }
      } catch (_) {}
      await sleep(100);
      check();
    };
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
  temp_log_path = path.join(__dirname, '..', 'test_ui_log_' + Date.now() + '.log');
  const content = [
    '{"ts":"2026-02-18T10:00:01","lv":"INFO","msg":"UI test line 1","fl":"test.js","ln":1}',
    '{"ts":"2026-02-18T10:00:02","lv":"ERROR","msg":"UI test error","fl":"test.js","ln":2}',
    '{"ts":"2026-02-18T10:00:03","lv":"WARN","msg":"UI test warning","fl":"test.js","ln":3}',
  ].join('\n');
  fs.writeFileSync(temp_log_path, content);
  return temp_log_path;
}

function appendToLog(line) {
  fs.appendFileSync(temp_log_path, line + '\n');
}

function cleanup() {
  stopServer();
  if (temp_log_path && fs.existsSync(temp_log_path)) {
    fs.unlinkSync(temp_log_path);
  }
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
  }
}

async function runTests() {
  const { chromium } = await import('playwright');
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

  console.log('\n--- Smart Log Viewer UI E2E Tests ---\n');

  await startServer();
  await sleep(500);

  const log_path = createTempLog();
  const base_url = `http://localhost:${PORT}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(base_url, { waitUntil: 'networkidle' });
    await sleep(500);

    ok(await page.title() === 'Smart Log Viewer', 'Page loads with correct title');

    const add_btn = page.locator('#add_path_btn');
    ok(await add_btn.isVisible(), 'Add button is visible');

    await add_btn.click();
    await sleep(200);

    const modal = page.locator('#add_path_overlay');
    ok(!(await modal.getAttribute('hidden')), 'Add modal opens');

    const path_input = page.locator('#new_path_input');
    await path_input.fill(log_path);

    const confirm_btn = page.locator('#confirm_add_btn');
    await confirm_btn.click();

    await page.waitForSelector('#add_path_overlay[hidden]', { timeout: 5000 }).catch(() => null);
    await sleep(500);

    const add_modal_visible = await modal.isVisible();
    ok(!add_modal_visible, 'Modal closes after add');

    const log_rows = page.locator('#log_body tr');
    await page.waitForSelector('#log_body tr', { timeout: 5000 }).catch(() => null);
    await sleep(500);

    const row_count = await log_rows.count();
    ok(row_count >= 1, `Logs display (${row_count} rows)`);

    const has_test_msg = await page.locator('text=UI test line 1').isVisible().catch(() => false);
    ok(has_test_msg, 'Expected log message visible');

    const file_items = page.locator('.file_item');
    const file_count = await file_items.count();
    ok(file_count >= 1, `File appears in sidebar (${file_count} items)`);

    const active_item = page.locator('.file_item.active');
    ok(await active_item.count() >= 1, 'File is selected (active state)');

    const empty_state = page.locator('#empty_state');
    const empty_hidden = await empty_state.evaluate((el) => el.classList.contains('hidden'));
    ok(empty_hidden, 'Empty state hidden when logs show');

    appendToLog('{"ts":"2026-02-18T10:00:04","lv":"INFO","msg":"Streaming new line","fl":"e2e.js","ln":4}');
    await sleep(1500);

    const has_streaming = await page.locator('text=Streaming new line').isVisible().catch(() => false);
    ok(has_streaming, 'New log appears in real-time');

    const first_row = page.locator('#log_body tr').first();
    await first_row.click();
    await sleep(200);

    const json_modal = page.locator('#modal_overlay');
    ok(!(await json_modal.getAttribute('hidden')), 'JSON modal opens on row click');

    await page.locator('#close_modal_btn').click();
    await page.waitForSelector('#modal_overlay[hidden]', { timeout: 3000 }).catch(() => null);
    const json_modal_closed = !(await json_modal.isVisible());
    ok(json_modal_closed, 'JSON modal closes');
  } catch (err) {
    console.log(`  ✗ Test error: ${err.message}`);
    failed++;
  } finally {
    await browser.close();
  }

  cleanup();
  await sleep(100);

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('UI test failed:', err);
  cleanup();
  process.exit(1);
});
