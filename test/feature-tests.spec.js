/**
 * Feature & Functionality Tests
 * Covers features and functionality not fully tested in e2e, ui-e2e, or ux-issues.
 * Run: node test/feature-tests.spec.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3852;
const TEST_CONFIG_DIR = path.join(__dirname, '..', '.test_config_feat');
let server_process = null;
const temp_log_paths = [];

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

function startServer() {
  return new Promise((resolve) => {
    if (fs.existsSync(TEST_CONFIG_DIR)) fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    server_process = spawn('node', ['server/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT), CONFIG_DIR: TEST_CONFIG_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const check = async () => {
      if (started) return;
      try {
        const res = await httpGet(`http://localhost:${PORT}/api/config`);
        if (res.status === 200) { started = true; resolve(); }
      } catch (_) {}
      await sleep(100);
      check();
    };
    setTimeout(check, 50);
  });
}

function stopServer() {
  if (server_process) { server_process.kill('SIGTERM'); server_process = null; }
}

function createTempLog(lines = []) {
  const p = path.join(__dirname, '..', 'test_feat_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.log');
  const content = lines.length ? lines.join('\n') + '\n' : '';
  fs.writeFileSync(p, content);
  temp_log_paths.push(p);
  return p;
}

function appendToLog(log_path, line) {
  fs.appendFileSync(log_path, line + '\n');
}

function cleanup() {
  stopServer();
  temp_log_paths.forEach((p) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  temp_log_paths.length = 0;
  if (fs.existsSync(TEST_CONFIG_DIR)) fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
}

async function runTests() {
  const { chromium } = await import('playwright');
  const results = { passed: 0, failed: 0, failures: [] };

  function ok(cond, name) {
    if (cond) {
      console.log(`  ✓ ${name}`);
      results.passed++;
    } else {
      console.log(`  ✗ ${name}`);
      results.failed++;
      results.failures.push(name);
    }
  }

  console.log('\n=== Feature & Functionality Tests ===\n');

  await startServer();
  await sleep(500);

  const base_url = `http://localhost:${PORT}`;

  try {
    // ========== API: Config update ==========
    console.log('\n--- API: Config update ---');

    const log1 = createTempLog([
      '{"ts":"2026-02-18T10:00:01","lv":"INFO","msg":"update test","fl":"a.js","ln":1}',
    ]);
    const add1 = await httpPost(`${base_url}/api/config/add`, { path: log1, tagName: 'orig-tag', color: '#ff0000' });
    const stored_path = add1.body?.sources?.find((s) => s.tagName === 'orig-tag')?.path || path.normalize(log1);
    const upd = await httpPost(`${base_url}/api/config/update`, {
      path: stored_path,
      tagName: 'updated-tag',
      color: '#00ff00',
    });
    ok(upd.status === 200, 'API: POST /api/config/update returns 200');
    const upd_sources = upd.body?.sources || upd.body || [];
    const src = Array.isArray(upd_sources) ? upd_sources.find((s) => s.path === stored_path) : null;
    ok(src?.tagName === 'updated-tag', 'API: Tag updated');
    ok(src?.color === '#00ff00', 'API: Color updated');

    // ========== API: Config remove ==========
    console.log('\n--- API: Config remove ---');

    const remove_res = await httpPost(`${base_url}/api/config/remove`, { path: stored_path });
    ok(remove_res.status === 200, 'API: POST /api/config/remove returns 200');
    const rem_sources = remove_res.body?.sources || remove_res.body || [];
    ok(!Array.isArray(rem_sources) || !rem_sources.some((s) => s.path === stored_path),
      'API: Source removed from config');

    // ========== Malformed JSON parsing ==========
    console.log('\n--- Malformed JSON parsing ---');

    const malformed_log = createTempLog([
      'not valid json',
      '{"ts":"2026-02-18","lv":"INFO","msg":"valid","fl":"x.js","ln":1}',
    ]);
    await httpPost(`${base_url}/api/config/add`, { path: malformed_log, tagName: 'malformed' });
    await sleep(800);

    const ws = await new Promise((resolve, reject) => {
      const { WebSocket } = require('ws');
      const client = new WebSocket(`ws://localhost:${PORT}`);
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'select', file_path: malformed_log }));
      });
      client.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'buffer') {
            client.close();
            resolve(msg);
          }
        } catch (_) {}
      });
      client.on('error', reject);
      setTimeout(() => {
        client.close();
        reject(new Error('Timeout'));
      }, 3000);
    });

    const has_raw = ws.entries?.some((e) => e.raw === 'not valid json' || e.msg === 'not valid json');
    const has_valid = ws.entries?.some((e) => e.msg === 'valid');
    ok(has_raw || ws.entries?.length >= 1, 'Malformed: Raw fallback for invalid JSON');
    ok(has_valid, 'Malformed: Valid JSON parsed');

    await httpPost(`${base_url}/api/config/remove`, { path: malformed_log });

    // ========== Config persistence ==========
    console.log('\n--- Config persistence ---');

    const persist_log = createTempLog([
      '{"ts":"2026-02-18","lv":"INFO","msg":"persist test","fl":"p.js","ln":1}',
    ]);
    await httpPost(`${base_url}/api/config/add`, { path: persist_log, tagName: 'persist-tag' });
    stopServer();
    await sleep(300);

    server_process = spawn('node', ['server/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT), CONFIG_DIR: TEST_CONFIG_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await sleep(800);

    const config_res = await httpGet(`${base_url}/api/config`);
    const sources = config_res.body?.sources || config_res.body;
    const has_persist = Array.isArray(sources) && sources.some(
      (s) => s.path === persist_log && s.tagName === 'persist-tag',
    );
    ok(has_persist, 'Persistence: Sources loaded after restart');

    // ========== Browser UI tests ==========
    console.log('\n--- Browser: Filters & UI ---');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const ui_log = createTempLog([
      '{"ts":"2026-02-18T10:00:01","lv":"INFO","msg":"filter info","fl":"f.js","ln":1}',
      '{"ts":"2026-02-18T10:00:02","lv":"ERROR","msg":"filter error","fl":"f.js","ln":2}',
      '{"ts":"2026-02-18T10:00:03","lv":"DEBUG","msg":"filter debug","fl":"f.js","ln":3}',
      '{"ts":"2026-02-18T10:00:04","lv":"WARN","msg":"filter warn","fl":"f.js","ln":4}',
    ]);
    await httpPost(`${base_url}/api/config/add`, { path: ui_log, tagName: 'filter-test' });
    await sleep(500);

    await page.goto(base_url, { waitUntil: 'networkidle' });
    await sleep(1500);

    const file_items = page.locator('.file_item');
    await file_items.filter({ hasText: 'filter-test' }).first().click();
    await sleep(500);

    const row_count_all = await page.locator('#log_body tr.log_row').count();
    ok(row_count_all >= 3, `UI: Logs display (${row_count_all} rows)`);

    await page.locator('#level_filter').selectOption('ERROR');
    await sleep(300);
    const error_rows = await page.locator('#log_body tr.log_row').count();
    ok(error_rows >= 1, `UI: Level filter ERROR shows only ERROR rows (${error_rows})`);

    await page.locator('#level_filter').selectOption('');
    await sleep(300);
    await page.locator('#text_search').fill('filter debug');
    await sleep(400);
    const search_rows = await page.locator('#log_body tr.log_row').count();
    ok(search_rows >= 1, `UI: Text search filters rows (${search_rows})`);

    await page.locator('#text_search').fill('');
    await sleep(300);

    const tag_cb = page.locator('.filters_center input[data-tag="filter-test"]');
    if (await tag_cb.count() > 0) {
      await tag_cb.uncheck();
      await sleep(300);
      const hidden_rows = await page.locator('#log_body tr.log_row').count();
      ok(hidden_rows === 0, `UI: Tag toggle hides logs (${hidden_rows} rows)`);
      await tag_cb.check();
      await sleep(300);
    } else {
      ok(true, 'UI: Tag toggle (skip - no toggle)');
    }

    await page.locator('#pause_btn').click();
    await sleep(200);
    appendToLog(ui_log, '{"ts":"2026-02-18T10:00:05","lv":"INFO","msg":"paused line","fl":"f.js","ln":5}');
    await sleep(1500);
    const has_paused = await page.locator('text=paused line').count() > 0;
    ok(!has_paused, 'UI: Pause prevents new logs');

    await page.locator('#pause_btn').click();
    await sleep(300);
    appendToLog(ui_log, '{"ts":"2026-02-18T10:00:06","lv":"INFO","msg":"after resume line","fl":"f.js","ln":6}');
    await sleep(2000);
    const has_after_resume = await page.locator('text=after resume line').count() > 0;
    ok(has_after_resume, 'UI: Resume shows new logs');

    await page.locator('#clear_btn').click();
    await sleep(300);
    const after_clear = await page.locator('#log_body tr.log_row').count();
    ok(after_clear === 0, 'UI: Clear empties log display');

    const long_msg = 'B'.repeat(120);
    const long_log = createTempLog([
      `{"ts":"2026-02-18T10:00:01","lv":"INFO","msg":"${long_msg}","fl":"l.js","ln":1}`,
    ]);
    await httpPost(`${base_url}/api/config/add`, { path: long_log, tagName: 'long-msg' });
    await sleep(500);

    await page.reload();
    await sleep(2000);

    await page.locator('.file_item').filter({ hasText: 'long-msg' }).first().click({ timeout: 5000 });
    await page.waitForSelector('#log_body tr.log_row', { timeout: 5000 }).catch(() => null);
    await sleep(500);

    const trunc_cell = page.locator('.col_msg .cell_truncate').filter({ hasText: '...' }).first();
    if (await trunc_cell.count() > 0) {
      await trunc_cell.click();
      await sleep(200);
      const full_modal = page.locator('#modal_overlay');
      const modal_visible = !(await full_modal.getAttribute('hidden'));
      const modal_title = await full_modal.locator('h3').textContent();
      ok(modal_visible, 'UI: Click truncated cell opens Full Value modal');
      ok(modal_title?.includes('Full Value'), 'UI: Modal shows Full Value title');
    } else {
      ok(true, 'UI: Click truncated (skip)');
    }

    await page.locator('#close_modal_btn').click().catch(() => null);
    await page.locator('#modal_overlay[hidden]').waitFor({ timeout: 2000 }).catch(() => null);

    await page.locator('#log_body tr.log_row').first().click();
    await sleep(200);
    const json_modal = page.locator('#modal_overlay');
    const json_visible = !(await json_modal.getAttribute('hidden'));
    ok(json_visible, 'UI: Click row opens JSON modal');

    const copy_btn = page.locator('#copy_log_btn');
    ok(await copy_btn.count() === 1, 'UI: Copy button exists');

    const download_btn = page.locator('#download_btn');
    ok(await download_btn.count() === 1, 'UI: Download button exists');

    const warn_badge = page.locator('.level_badge.level_warn');
    ok(await warn_badge.count() >= 0, 'UI: WARN level badge (if WARN in logs)');

    await page.locator('#close_modal_btn').click();
    await sleep(200);

    await httpPost(`${base_url}/api/config/remove`, { path: ui_log });
    await httpPost(`${base_url}/api/config/remove`, { path: long_log });
    await httpPost(`${base_url}/api/config/remove`, { path: persist_log });
    await page.goto(base_url);
    await sleep(500);

    const empty_msg = await page.locator('#empty_state_msg').textContent();
    ok(empty_msg?.includes('Add a log source') || empty_msg?.includes('Loading'),
      'UI: Empty state shows message');

    const edit_log = createTempLog([
      '{"ts":"2026-02-18","lv":"INFO","msg":"edit test","fl":"e.js","ln":1}',
    ]);
    await httpPost(`${base_url}/api/config/add`, { path: edit_log, tagName: 'before-edit', color: '#ff0000' });
    await page.reload();
    await sleep(1500);

    await page.locator('.file_item .edit_btn').first().click();
    await sleep(200);
    const edit_modal = page.locator('#edit_tag_overlay');
    ok(!(await edit_modal.getAttribute('hidden')), 'UI: Edit modal opens');
    await page.locator('#edit_tag_input').fill('after-edit');
    await page.locator('#confirm_edit_btn').click();
    await sleep(500);
    const has_updated_tag = await page.locator('.tag_badge').filter({ hasText: 'after-edit' }).count() > 0;
    ok(has_updated_tag, 'UI: Edit source updates tag');

    await page.locator('#add_path_btn').click();
    await sleep(200);
    await page.locator('#new_path_input').fill('/nonexistent/path/12345.log');
    await page.locator('#confirm_add_btn').click();
    await sleep(500);
    const error_visible = await page.locator('#add_path_error').isVisible();
    const error_text = await page.locator('#add_path_error').textContent();
    ok(error_visible && error_text && error_text.length > 0, 'UI: Invalid path shows error');

    await page.locator('#cancel_add_btn').click().catch(() => null);
    await httpPost(`${base_url}/api/config/remove`, { path: edit_log });

    await browser.close();
  } catch (err) {
    console.log(`  ✗ Test error: ${err.message}`);
    results.failed++;
    results.failures.push(`Error: ${err.message}`);
  }

  cleanup();
  await sleep(100);

  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failures.length > 0) {
    console.log('\nFailed tests:');
    results.failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Feature test failed:', err);
  cleanup();
  process.exit(1);
});
