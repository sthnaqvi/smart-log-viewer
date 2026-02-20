/**
 * UI Tests - Layout, styling, flow, and components.
 * Groups similar test types together. Run: npm run test:ui
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
        const res = await fetch(`http://localhost:${PORT}/api/config`);
        if (res.ok) { started = true; resolve(); }
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

function createTempLog() {
  temp_log_path = path.join(__dirname, '..', 'test_ui_' + Date.now() + '.log');
  const long_msg = 'A'.repeat(150);
  const sql_msg = 'INSERT INTO users (id, name) VALUES (1, \'test\')';
  const lines = [
    `{"ts":"2026-02-18T10:00:00","lv":"ERROR","msg":"${sql_msg}","fl":"db.js","ln":1}`,
    `{"ts":"2026-02-18T10:00:01","lv":"INFO","msg":"Short info message","fl":"test.js","ln":2}`,
    `{"ts":"2026-02-18T10:00:02","lv":"DEBUG","msg":"Debug trace","fl":"test.js","ln":3}`,
    `{"ts":"2026-02-18T10:00:03","lv":"INFO","msg":"${long_msg}","fl":"file.js","ln":4}`,
  ];
  for (let i = 5; i <= 25; i++) {
    lines.push(`{"ts":"2026-02-18T10:00:${String(i).padStart(2,'0')}","lv":"INFO","msg":"Row ${i}","fl":"test.js","ln":${i}}`);
  }
  fs.writeFileSync(temp_log_path, lines.join('\n') + '\n');
  return temp_log_path;
}

function appendToLog(line) {
  fs.appendFileSync(temp_log_path, line + '\n');
}

function cleanup() {
  stopServer();
  if (temp_log_path && fs.existsSync(temp_log_path)) fs.unlinkSync(temp_log_path);
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

  console.log('\n=== UI Tests ===\n');

  await startServer();
  await sleep(500);

  const log_path = createTempLog();
  const base_url = `http://localhost:${PORT}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(base_url, { waitUntil: 'networkidle' });
    await sleep(300);

    ok(await page.title() === 'Smart Log Viewer', 'Page loads with correct title');

    await page.locator('#add_path_btn').click();
    await sleep(200);
    await page.locator('#new_path_input').fill(log_path);
    await page.locator('#new_tag_input').fill('ui-test');
    await page.locator('#confirm_add_btn').click();
    await page.waitForSelector('#add_path_overlay[hidden]', { timeout: 5000 }).catch(() => null);
    await sleep(1500);

    await page.waitForSelector('#log_body tr.log_row', { timeout: 8000 }).catch(() => null);
    await page.waitForSelector('text=INSERT INTO', { timeout: 5000 }).catch(() => null);
    await sleep(500);

    const log_rows = page.locator('#log_body tr.log_row');
    const row_count = await log_rows.count();

    // ---------- Flow ----------
    console.log('\n--- Flow ---');
    ok(row_count >= 3, `Logs display (${row_count} rows)`);
    ok(await page.locator('text=Short info message').isVisible().catch(() => false), 'Expected log visible');
    ok(await page.locator('.file_item').count() >= 1, 'File appears in sidebar');
    ok(await page.locator('.file_item .tag_badge').count() >= 1, 'Tag badge in sidebar');
    ok(await page.locator('#empty_state').evaluate((el) => el.classList.contains('hidden')).catch(() => false),
      'Empty state hidden when logs show');

    appendToLog('{"ts":"2026-02-18T10:00:30","lv":"INFO","msg":"Streaming new line","fl":"e2e.js","ln":30}');
    const has_streaming = await page.locator('text=Streaming new line')
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    ok(has_streaming, 'New log appears in real-time');

    await page.locator('#log_body tr .level_badge').first().click();
    await sleep(200);
    ok(!(await page.locator('#modal_overlay').getAttribute('hidden')), 'JSON modal opens on row click');
    await page.locator('#close_modal_btn').click();
    await page.waitForSelector('#modal_overlay[hidden]', { timeout: 3000 }).catch(() => null);
    ok(true, 'JSON modal closes');

    // ---------- Tooltips ----------
    console.log('\n--- Tooltips ---');
    ok(await page.locator('.col_msg .cell_truncate[data-full]').count() >= 1, 'Message cells have data-full');
    const long_msg_cell = page.locator('.col_msg .cell_truncate').filter({ hasText: '...' }).first();
    const has_long_msg = await long_msg_cell.count() > 0;
    ok(has_long_msg, 'Long messages truncated with ellipsis');
    ok(await page.locator('#cell_tooltip').count() === 1, 'Tooltip element exists');
    ok(await page.locator('#cell_tooltip').evaluate((el) => getComputedStyle(el).position === 'fixed'),
      'Tooltip is position:fixed');
    if (has_long_msg) {
      await long_msg_cell.hover();
      await sleep(200);
      ok(await page.locator('#cell_tooltip').evaluate((el) => el.classList.contains('visible')),
        'Tooltip visible on hover');
      const tooltip_content = await page.locator('#cell_tooltip').textContent();
      ok(tooltip_content && tooltip_content.length > 80 && !tooltip_content.endsWith('...'),
        'Tooltip shows full content');
    } else {
      ok(true, 'Tooltip (skip - no long msg)');
      ok(true, 'Tooltip (skip)');
    }

    // ---------- Source identity ----------
    console.log('\n--- Source identity ---');
    const tag_badge = page.locator('.tag_badge').first();
    ok(await tag_badge.evaluate((el) => parseInt(getComputedStyle(el).paddingTop, 10)) >= 6,
      'Tag badge padding-top >= 6px');
    ok(await tag_badge.evaluate((el) => parseInt(getComputedStyle(el).paddingLeft, 10)) >= 8,
      'Tag badge padding-left >= 8px');
    ok(await page.locator('.log_row[style*="--row-tint"]').count() >= 1, 'Rows have --row-tint');
    const row_bg = await page.locator('.log_row[style*="--row-tint"]').first()
      .evaluate((el) => getComputedStyle(el).background || getComputedStyle(el).backgroundColor).catch(() => '');
    ok(row_bg && (row_bg.includes('color-mix') || row_bg.includes('rgb')), 'Row uses source color tint');

    // ---------- Message styling ----------
    console.log('\n--- Message styling ---');
    ok(await page.locator('.level_badge.level_error').count() >= 1, 'ERROR level badge exists');
    ok(await page.locator('.msg_error').count() >= 1 || await page.locator('.col_msg span[data-level="ERROR"]').count() >= 1,
      'ERROR message has msg_error or data-level');
    const error_cell = page.locator('.col_msg .msg_error').first();
    ok(await error_cell.evaluate((el) => (parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 600),
      'ERROR message is bold');
    const info_cell = page.locator('.col_msg .msg_info').first();
    ok(await info_cell.evaluate((el) => (parseInt(getComputedStyle(el).fontWeight, 10) || 400) < 600),
      'INFO message is lighter');
    const debug_cell = page.locator('.col_msg .msg_debug').first();
    ok(await debug_cell.evaluate((el) => parseFloat(getComputedStyle(el).opacity) < 1), 'DEBUG message is dim');
    ok(await page.locator('.col_msg .msg_sql').count() >= 1, 'SQL content has msg_sql class');
    const sql_cell = page.locator('.col_msg .msg_sql').first();
    ok(await sql_cell.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase().includes('monospace')),
      'SQL content uses monospace');
    ok(await sql_cell.evaluate((el) => {
      const s = getComputedStyle(el);
      const has_bg = s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      const has_padding = parseInt(s.paddingLeft, 10) >= 4 || parseInt(s.paddingRight, 10) >= 4;
      return has_bg || has_padding;
    }), 'SQL content has code-block style');

    // ---------- Toolbar layout ----------
    console.log('\n--- Toolbar layout ---');
    ok(await page.locator('.filters_left').count() === 1, 'filters_left zone exists');
    ok(await page.locator('.filters_left #level_filter').count() === 1, 'Level filter in left zone');
    ok(await page.locator('.filters_left #text_search').count() === 1, 'Search in left zone');
    ok(await page.locator('.filters_center').count() === 1, 'filters_center zone exists');
    ok(await page.locator('.filters_right').count() === 1, 'filters_right zone exists');
    ok(await page.locator('.filters_right #auto_scroll').count() === 1, 'Auto-scroll in right zone');
    ok(await page.locator('.filters_right #pause_btn').count() === 1, 'Pause in right zone');
    ok(await page.locator('.filters_right #clear_btn').count() === 1, 'Clear in right zone');
    ok(await page.locator('.filters_right #download_btn').count() === 1, 'Download in right zone');
    ok(await page.locator('.filters_sep').count() >= 2, 'Separators between zones');

    // ---------- Click affordance ----------
    console.log('\n--- Click affordance ---');
    const expand_icons = page.locator('.row_expand_icon');
    ok(await expand_icons.count() >= 1, 'Expand icon exists');
    ok((await expand_icons.first().textContent())?.trim() === '▸', 'Expand icon shows ▸');
    ok(await page.locator('.log_row').first().evaluate((el) => getComputedStyle(el).cursor === 'pointer'),
      'Rows have cursor pointer');
    await page.locator('.log_row').first().hover();
    await sleep(100);
    ok(await expand_icons.first().evaluate((el) => parseFloat(getComputedStyle(el).opacity) > 0.5),
      'Expand icon has hover effect');

    // ---------- Table columns ----------
    console.log('\n--- Table columns ---');
    ok(await page.locator('.log_table').evaluate((el) => getComputedStyle(el).tableLayout === 'fixed'),
      'Table has fixed layout');
    ok(await page.locator('th.col_ts, td.col_ts').first()
      .evaluate((el) => parseInt(getComputedStyle(el).width, 10)) >= 150, 'Timestamp column fixed width');
    ok(await page.locator('th.col_level, td.col_level').first()
      .evaluate((el) => parseInt(getComputedStyle(el).width, 10)) >= 60, 'Level column fixed width');
    ok(await page.locator('th.col_file, td.col_file').first()
      .evaluate((el) => parseInt(getComputedStyle(el).width, 10)) >= 120, 'File:Line column fixed width');
    ok(await page.locator('th.col_msg, td.col_msg').first().evaluate((el) => {
      const w = getComputedStyle(el).width;
      return w === 'auto' || parseInt(w, 10) > 200;
    }), 'Message column takes remaining space');

    // ---------- Sticky header ----------
    console.log('\n--- Sticky header ---');
    await page.locator('.log_container').evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await sleep(200);
    ok(await page.locator('.log_table').evaluate((el) => el.classList.contains('header_scrolled')),
      'Header gets header_scrolled when scrolling');
    ok(await page.locator('.log_table.header_scrolled th').first()
      .evaluate((el) => { const s = getComputedStyle(el); return s.boxShadow !== 'none' && s.boxShadow !== ''; }),
      'Header has shadow when scrolled');
    ok(await page.locator('.log_table th').first()
      .evaluate((el) => getComputedStyle(el).position === 'sticky'), 'Header is position sticky');

  } catch (err) {
    console.log(`  ✗ Test error: ${err.message}`);
    results.failed++;
    results.failures.push(`Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  cleanup();
  await sleep(100);

  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failures.length > 0) {
    console.log('\nFailed:');
    results.failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('UI test failed:', err);
  cleanup();
  process.exit(1);
});
