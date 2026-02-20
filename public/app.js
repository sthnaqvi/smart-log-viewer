(function () {
  'use strict';

  const LOG_WINDOW_CAP = 2000;
  const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_URL = `${WS_PROTOCOL}//${window.location.host}`;

  let sources = [];
  let path_to_source = {};
  let focused_source = null;
  let log_entries = [];
  let is_paused = false;
  let ws = null;
  let selected_entry_for_modal = null;
  let visible_tags = new Set();

  const $file_list = document.getElementById('file_list');
  const $log_body = document.getElementById('log_body');
  const $level_filter = document.getElementById('level_filter');
  const $text_search = document.getElementById('text_search');
  const $auto_scroll = document.getElementById('auto_scroll');
  const $pause_btn = document.getElementById('pause_btn');
  const $clear_btn = document.getElementById('clear_btn');
  const $add_path_btn = document.getElementById('add_path_btn');
  const $modal_overlay = document.getElementById('modal_overlay');
  const $modal_content = document.getElementById('modal_content');
  const $copy_log_btn = document.getElementById('copy_log_btn');
  const $close_modal_btn = document.getElementById('close_modal_btn');
  const $add_path_overlay = document.getElementById('add_path_overlay');
  const $new_path_input = document.getElementById('new_path_input');
  const $new_tag_input = document.getElementById('new_tag_input');
  const $new_color_input = document.getElementById('new_color_input');
  const $color_hex = document.getElementById('color_hex');
  const $confirm_add_btn = document.getElementById('confirm_add_btn');
  const $cancel_add_btn = document.getElementById('cancel_add_btn');
  const $add_path_error = document.getElementById('add_path_error');
  const $empty_state = document.getElementById('empty_state');
  const $empty_state_msg = document.getElementById('empty_state_msg');
  const $empty_illustration = document.getElementById('empty_illustration');
  const $visible_sources = document.getElementById('visible_sources');
  const $edit_tag_overlay = document.getElementById('edit_tag_overlay');
  const $edit_path_input = document.getElementById('edit_path_input');
  const $edit_tag_input = document.getElementById('edit_tag_input');
  const $edit_color_input = document.getElementById('edit_color_input');
  const $edit_color_hex = document.getElementById('edit_color_hex');
  const $confirm_edit_btn = document.getElementById('confirm_edit_btn');
  const $cancel_edit_btn = document.getElementById('cancel_edit_btn');
  const $cell_tooltip = document.getElementById('cell_tooltip');

  function buildPathToSource() {
    path_to_source = {};
    for (const s of sources) {
      path_to_source[s.path] = s;
    }
  }

  function getSourceForPath(path) {
    return path_to_source[path] || { tagName: path.split('/').pop(), color: '#8b949e' };
  }

  function getLevelClass(level) {
    const lv = (level || '').toUpperCase();
    if (lv === 'ERROR') return 'level_error';
    if (lv === 'WARN') return 'level_warn';
    if (lv === 'INFO') return 'level_info';
    if (lv === 'DEBUG') return 'level_debug';
    return '';
  }

  function formatTs(ts) {
    if (!ts) return '-';
    return String(ts);
  }

  function formatFileLine(entry) {
    const fl = entry.fl || entry.file;
    const ln = entry.ln || entry.line;
    if (!fl && !ln) return '-';
    if (fl && ln != null) return `${fl}:${ln}`;
    return fl || String(ln) || '-';
  }

  function formatMsg(entry) {
    return entry.msg || entry.message || entry.raw || '-';
  }

  function isSqlLike(text) {
    const lower = String(text).toLowerCase();
    return /\b(select|insert|update|delete|from|where|into|values)\b/.test(lower);
  }

  function matchesFilters(entry) {
    const level = (entry.lv || entry.level || '').toUpperCase();
    const filter_level = $level_filter.value;
    if (filter_level && level !== filter_level) return false;

    const search = $text_search.value.trim().toLowerCase();
    if (!search) return true;

    const str = JSON.stringify(entry).toLowerCase();
    return str.includes(search);
  }

  function matchesTagFilter(entry) {
    if (visible_tags.size === 0) return true;
    const tag = entry._source_tag || '';
    if (!visible_tags.has(tag)) return false;
    if (focused_source) return entry._file_path === focused_source;
    return true;
  }

  function capEntries(entries) {
    if (entries.length <= LOG_WINDOW_CAP) return entries;
    return entries.slice(-LOG_WINDOW_CAP);
  }

  function updateEmptyState() {
    if (!sources.length) {
      $empty_state.classList.remove('hidden');
      $empty_state_msg.textContent = 'Add a log source using the + button above.';
    } else if (log_entries.length === 0) {
      $empty_state.classList.remove('hidden');
      $empty_state_msg.textContent = 'Loading logs... Append to files to see entries.';
    } else {
      $empty_state.classList.add('hidden');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function cellWithTooltip(content, full_content) {
    const truncated = String(content);
    const needs_tooltip = full_content != null && String(full_content).length > 50;
    const display = truncated.length > 80 ? truncated.slice(0, 77) + '...' : truncated;
    if (needs_tooltip) {
      return `<span class="cell_truncate" data-full="${escapeHtml(String(full_content))}" title="">${escapeHtml(display)}</span>`;
    }
    return escapeHtml(display);
  }

  function renderLogs() {
    const filtered = log_entries
      .filter(matchesFilters)
      .filter(matchesTagFilter);
    const capped = capEntries(filtered);

    updateEmptyState();

    $log_body.innerHTML = capped
      .map((entry, idx) => {
        const level = String(entry.lv || entry.level || '').trim();
        const level_class = getLevelClass(level);
        const source = getSourceForPath(entry._file_path);
        const tag = entry._source_tag || source.tagName;
        const color = source.color;
        const raw_idx = log_entries.indexOf(entry);
        const ts = formatTs(entry.ts);
        const fl = formatFileLine(entry);
        const msg = formatMsg(entry);
        const row_class = idx % 2 === 1 ? 'row_alt' : '';
        const lv = (level || '').toUpperCase();
        const msg_level = lv === 'ERROR' ? 'msg_error' : lv === 'INFO' ? 'msg_info' : lv === 'DEBUG' ? 'msg_debug' : '';
        const msg_sql = isSqlLike(msg) ? 'msg_sql' : '';
        const msg_display = msg.length > 100 ? msg.slice(0, 97) + '...' : msg;
        return `
          <tr class="${row_class} log_row" data-index="${idx}" data-raw-index="${raw_idx}" style="--row-tint:${escapeHtml(color)}">
            <td class="col_expand"><span class="row_expand_icon" aria-hidden="true">▸</span></td>
            <td class="col_tag"><span class="tag_badge" style="--tag-color:${escapeHtml(color)}">${escapeHtml(tag)}</span></td>
            <td class="col_ts"><span class="cell_truncate" data-full="${escapeHtml(ts)}">${escapeHtml(ts)}</span></td>
            <td class="col_level"><span class="level_badge ${level_class}">${escapeHtml(level || '-')}</span></td>
            <td class="col_file"><span class="cell_truncate" data-full="${escapeHtml(fl)}">${escapeHtml(fl.length > 60 ? fl.slice(0, 57) + '...' : fl)}</span></td>
            <td class="col_msg"><span class="cell_truncate msg_cell ${msg_level} ${msg_sql}" data-full="${escapeHtml(msg)}" data-level="${escapeHtml(lv)}">${escapeHtml(msg_display)}</span></td>
          </tr>
        `;
      })
      .join('');

    bindCellTooltips();
    bindRowClicks();

    if ($auto_scroll.checked) {
      const container = document.querySelector('.log_container');
      if (container) container.scrollTop = container.scrollHeight;
    }
  }

  function bindCellTooltips() {
    if ($log_body._tooltipBound) return;
    $log_body._tooltipBound = true;
    $log_body.onmouseover = (e) => {
      const el = e.target.closest('.cell_truncate[data-full]');
      if (!el) { hideTooltip(); return; }
      const full = el.getAttribute('data-full');
      if (!full || full === el.textContent) return;
      showTooltip(e, full);
    };
    $log_body.onmouseout = (e) => {
      const next = e.relatedTarget?.closest?.('.cell_truncate');
      if (!next) hideTooltip();
    };
  }

  function showTooltip(e, text) {
    $cell_tooltip.textContent = text;
    $cell_tooltip.classList.add('visible');
    positionTooltip(e);
  }

  function positionTooltip(e) {
    const rect = $cell_tooltip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY + 12;
    if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 12;
    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 12;
    $cell_tooltip.style.left = x + 'px';
    $cell_tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    $cell_tooltip.classList.remove('visible');
  }

  function showExpandModal(text) {
    $modal_content.textContent = text;
    $modal_overlay.querySelector('h3').textContent = 'Full Value';
    $modal_overlay.hidden = false;
    selected_entry_for_modal = null;
  }

  function bindRowClicks() {
    if ($log_body._rowClick) return;
    $log_body._rowClick = true;
    $log_body.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell_truncate[data-full]');
      if (cell) {
        e.stopPropagation();
        const full = cell.getAttribute('data-full');
        if (full) showExpandModal(full);
        return;
      }
      const row = e.target.closest('tr.log_row');
      if (!row) return;
      const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
      const entry = log_entries[raw_idx];
      if (entry) openModal(entry);
    });
  }

  function addLogEntry(entry, file_path) {
    if (is_paused) return;
    const source = getSourceForPath(file_path);
    const enriched = { ...entry, _file_path: file_path, _source_tag: source.tagName };
    log_entries.push(enriched);
    if (log_entries.length > LOG_WINDOW_CAP) log_entries.shift();
    renderLogs();
  }

  function requestAllBuffers() {
    if (!ws || ws.readyState !== 1) {
      if (ws && ws.readyState === 0) {
        ws.addEventListener('open', requestAllBuffers, { once: true });
      }
      return;
    }
    for (const s of sources) {
      ws.send(JSON.stringify({ type: 'select', file_path: s.path }));
    }
  }

  function connectWs() {
    if (ws && ws.readyState === 1) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => requestAllBuffers();

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'log') {
          addLogEntry(msg.entry, msg.file_path);
        }
        if (msg.type === 'buffer') {
          const source = getSourceForPath(msg.file_path);
          const new_entries = (msg.entries || []).map((e) => ({
            ...e,
            _file_path: msg.file_path,
            _source_tag: source.tagName,
          }));
          log_entries = log_entries
            .filter((e) => e._file_path !== msg.file_path)
            .concat(new_entries)
            .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
          if (log_entries.length > LOG_WINDOW_CAP) {
            log_entries = log_entries.slice(-LOG_WINDOW_CAP);
          }
          renderLogs();
        }
      } catch (_) {}
    };

    ws.onclose = () => setTimeout(connectWs, 2000);
  }

  function fetchConfig() {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        sources = data.sources || [];
        buildPathToSource();
        visible_tags.clear();
        sources.forEach((s) => visible_tags.add(s.tagName));
        renderTagToggles();
        renderFileList();
        if (focused_source && !sources.some((s) => s.path === focused_source)) {
          focused_source = null;
        }
        requestAllBuffers();
      })
      .catch(() => {});
  }

  function renderTagToggles() {
    if (sources.length === 0) {
      $visible_sources.innerHTML = '';
      return;
    }
    $visible_sources.innerHTML = '<span class="filter_label">Visible:</span>' + sources
      .map(
        (s) => `
      <label class="tag_toggle" title="Toggle ${escapeHtml(s.tagName)}">
        <input type="checkbox" data-tag="${escapeHtml(s.tagName)}" checked>
        <span class="tag_toggle_badge" style="--tag-color:${escapeHtml(s.color)}">${escapeHtml(s.tagName)}</span>
      </label>
    `
      )
      .join('');
    $visible_sources.querySelectorAll('input[data-tag]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) visible_tags.add(cb.dataset.tag);
        else visible_tags.delete(cb.dataset.tag);
        renderLogs();
      });
    });
  }

  function renderFileList() {
    updateEmptyState();
    $file_list.innerHTML = sources
      .map(
        (s) => `
        <li class="file_item ${s.path === focused_source ? 'active' : ''}" data-path="${escapeHtml(s.path)}">
          <span class="tag_badge" style="--tag-color:${escapeHtml(s.color)}">${escapeHtml(s.tagName)}</span>
          <span class="path_text" title="${escapeHtml(s.path)}">${escapeHtml(s.path.split('/').pop())}</span>
          <button type="button" class="edit_btn" title="Edit">✎</button>
          <button type="button" class="remove_btn" title="Remove">×</button>
        </li>
      `
      )
      .join('');

    $file_list.querySelectorAll('.file_item').forEach((el) => {
      const path_val = el.getAttribute('data-path');
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('remove_btn') && !e.target.classList.contains('edit_btn')) {
          setFocusedSource(path_val);
        }
      });
      el.querySelector('.remove_btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removePath(path_val);
      });
      el.querySelector('.edit_btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(path_val);
      });
    });
  }

  function setFocusedSource(file_path) {
    focused_source = file_path === focused_source ? null : file_path;
    renderFileList();
    renderLogs();
  }

  function tagFromPath(p) {
    const base = p.split('/').pop() || '';
    return base.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || base || 'log';
  }

  function openAddPathModal() {
    $add_path_overlay.hidden = false;
    $new_path_input.value = '';
    $new_tag_input.value = '';
    $new_color_input.value = '#a371f7';
    $color_hex.textContent = '#a371f7';
    $add_path_error.textContent = '';
    $new_path_input.focus();
  }

  function closeAddPathModal() {
    $add_path_overlay.hidden = true;
  }

  function addPath() {
    const path_val = $new_path_input.value.trim();
    if (!path_val) return;

    const tag_val = $new_tag_input.value.trim() || tagFromPath(path_val);
    const color_val = $new_color_input.value;

    $add_path_error.textContent = '';

    fetch('/api/config/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path_val, tagName: tag_val, color: color_val }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data })))
      .then(({ ok, status, data }) => {
        if (!ok || data.error) {
          $add_path_error.textContent = data.error || `Request failed (status ${status})`;
          return;
        }
        sources = data.sources || [];
        buildPathToSource();
        visible_tags.add(tag_val);
        renderTagToggles();
        renderFileList();
        closeAddPathModal();
        requestAllBuffers();
      })
      .catch((err) => {
        $add_path_error.textContent = err.message || 'Failed to add';
      });
  }

  function openEditModal(path_val) {
    const s = getSourceForPath(path_val);
    $edit_path_input.value = path_val;
    $edit_tag_input.value = s.tagName || '';
    $edit_color_input.value = s.color || '#a371f7';
    $edit_color_hex.textContent = s.color || '#a371f7';
    $edit_tag_overlay.hidden = false;
    $edit_tag_input.focus();
  }

  function closeEditModal() {
    $edit_tag_overlay.hidden = true;
  }

  $edit_color_input.addEventListener('input', () => {
    $edit_color_hex.textContent = $edit_color_input.value;
  });

  $new_color_input.addEventListener('input', () => {
    $color_hex.textContent = $new_color_input.value;
  });

  function saveEdit() {
    const path_val = $edit_path_input.value;
    const tag_val = $edit_tag_input.value.trim();
    const color_val = $edit_color_input.value;
    if (!tag_val) return;

    const old_tag = getSourceForPath(path_val).tagName;

    fetch('/api/config/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path_val, tagName: tag_val, color: color_val }),
    })
      .then((r) => r.json())
      .then((data) => {
        sources = data.sources || [];
        buildPathToSource();
        visible_tags.delete(old_tag);
        visible_tags.add(tag_val);
        renderTagToggles();
        renderFileList();
        renderLogs();
        closeEditModal();
      })
      .catch(() => {});
  }

  function removePath(path_val) {
    fetch('/api/config/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path_val }),
    })
      .then((r) => r.json())
      .then((data) => {
        sources = data.sources || [];
        buildPathToSource();
        if (focused_source === path_val) focused_source = null;
        renderTagToggles();
        renderFileList();
        renderLogs();
      })
      .catch(() => {});
  }

  function openModal(entry) {
    const clean = { ...entry };
    delete clean._file_path;
    delete clean._source_tag;
    selected_entry_for_modal = entry;
    $modal_content.textContent = JSON.stringify(clean, null, 2);
    $modal_overlay.querySelector('h3').textContent = 'Log Entry (JSON)';
    $modal_overlay.hidden = false;
  }

  function closeModal() {
    $modal_overlay.hidden = true;
    selected_entry_for_modal = null;
  }

  function copySelectedLog() {
    const text = selected_entry_for_modal
      ? (() => {
          const clean = { ...selected_entry_for_modal };
          delete clean._file_path;
          delete clean._source_tag;
          return JSON.stringify(clean, null, 2);
        })()
      : $modal_content.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      $copy_log_btn.textContent = 'Copied!';
      setTimeout(() => { $copy_log_btn.textContent = 'Copy'; }, 1500);
    });
  }

  function downloadVisibleLogs() {
    const filtered = log_entries.filter(matchesFilters).filter(matchesTagFilter);
    const text = filtered.map((e) => {
      const c = { ...e };
      delete c._file_path;
      delete c._source_tag;
      return JSON.stringify(c);
    }).join('\n');
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${active_file ? active_file.split('/').pop() : 'export'}_${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  $add_path_btn.addEventListener('click', openAddPathModal);
  $confirm_add_btn.addEventListener('click', addPath);
  $cancel_add_btn.addEventListener('click', closeAddPathModal);
  $confirm_edit_btn.addEventListener('click', saveEdit);
  $cancel_edit_btn.addEventListener('click', closeEditModal);

  $new_path_input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPath();
    if (e.key === 'Escape') closeAddPathModal();
  });

  $new_path_input.addEventListener('input', () => {
    if (!$new_tag_input.value) $new_tag_input.value = tagFromPath($new_path_input.value);
  });

  $level_filter.addEventListener('change', renderLogs);
  $text_search.addEventListener('input', debounce(renderLogs, 150));

  $pause_btn.addEventListener('click', () => {
    is_paused = !is_paused;
    $pause_btn.textContent = is_paused ? 'Resume' : 'Pause';
  });

  $clear_btn.addEventListener('click', () => {
    log_entries = [];
    renderLogs();
  });

  $close_modal_btn.addEventListener('click', closeModal);
  $copy_log_btn.addEventListener('click', copySelectedLog);

  $modal_overlay.addEventListener('click', (e) => {
    if (e.target === $modal_overlay) closeModal();
  });

  document.getElementById('add_path_overlay').addEventListener('click', (e) => {
    if (e.target.id === 'add_path_overlay') closeAddPathModal();
  });

  document.getElementById('edit_tag_overlay').addEventListener('click', (e) => {
    if (e.target.id === 'edit_tag_overlay') closeEditModal();
  });

  document.addEventListener('mousemove', (e) => {
    if ($cell_tooltip.classList.contains('visible')) positionTooltip(e);
  });

  document.getElementById('download_btn').addEventListener('click', downloadVisibleLogs);

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  fetch('/empty-illustration.svg')
    .then((r) => r.text())
    .then((svg) => {
      $empty_illustration.innerHTML = svg;
      $empty_illustration.querySelector('svg')?.setAttribute('class', 'empty_svg');
    })
    .catch(() => {});

  const log_container = document.querySelector('.log_container');
  const log_table = document.getElementById('log_table');
  if (log_container && log_table) {
    log_container.addEventListener('scroll', () => {
      log_table.classList.toggle('header_scrolled', log_container.scrollTop > 2);
    });
  }

  fetchConfig();
  connectWs();
})();
