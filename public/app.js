(function () {
  'use strict';

  const LOG_WINDOW_CAP = 2000;
  const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_URL = `${WS_PROTOCOL}//${window.location.host}`;

  let file_paths = [];
  let active_file = null;
  let log_entries = [];
  let is_paused = false;
  let ws = null;
  let selected_entry_for_modal = null;

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
  const $confirm_add_btn = document.getElementById('confirm_add_btn');
  const $cancel_add_btn = document.getElementById('cancel_add_btn');
  const $add_path_error = document.getElementById('add_path_error');
  const $empty_state = document.getElementById('empty_state');
  const $empty_state_msg = document.getElementById('empty_state_msg');

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

  function matchesFilters(entry) {
    const level = (entry.lv || entry.level || '').toUpperCase();
    const filter_level = $level_filter.value;
    if (filter_level && level !== filter_level) return false;

    const search = $text_search.value.trim().toLowerCase();
    if (!search) return true;

    const str = JSON.stringify(entry).toLowerCase();
    return str.includes(search);
  }

  function capEntries(entries) {
    if (entries.length <= LOG_WINDOW_CAP) return entries;
    return entries.slice(-LOG_WINDOW_CAP);
  }

  function updateEmptyState() {
    if (!file_paths.length) {
      $empty_state.classList.remove('hidden');
      $empty_state_msg.textContent =
        'Add a log file using the + button above, then click it to view logs.';
    } else if (!active_file) {
      $empty_state.classList.remove('hidden');
      $empty_state_msg.textContent = 'Click a log file in the sidebar to view logs.';
    } else if (log_entries.length === 0) {
      $empty_state.classList.remove('hidden');
      $empty_state_msg.textContent =
        'Loading logs... Append to the file to see new entries.';
    } else {
      $empty_state.classList.add('hidden');
    }
  }

  function renderLogs() {
    const filtered = log_entries.filter(matchesFilters);
    const capped = capEntries(filtered);

    updateEmptyState();

    $log_body.innerHTML = capped
      .map(
        (entry, idx) => {
          const level = entry.lv || entry.level || '';
          const level_class = getLevelClass(level);
          return `
            <tr data-index="${idx}" data-raw-index="${log_entries.indexOf(entry)}">
              <td class="col_ts">${escapeHtml(formatTs(entry.ts))}</td>
              <td class="col_level ${level_class}">${escapeHtml(level || '-')}</td>
              <td class="col_file">${escapeHtml(formatFileLine(entry))}</td>
              <td class="col_msg">${escapeHtml(formatMsg(entry))}</td>
            </tr>
          `;
        }
      )
      .join('');

    if ($auto_scroll.checked) {
      const container = document.querySelector('.log_container');
      if (container) container.scrollTop = container.scrollHeight;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function addLogEntry(entry) {
    if (is_paused) return;
    log_entries.push(entry);
    if (log_entries.length > LOG_WINDOW_CAP) {
      log_entries.shift();
    }
    renderLogs();
  }

  function connectWs() {
    if (ws && ws.readyState === 1) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      if (active_file) {
        ws.send(JSON.stringify({ type: 'select', file_path: active_file }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'log' && msg.file_path === active_file) {
          addLogEntry(msg.entry);
        }
        if (msg.type === 'buffer' && msg.file_path === active_file) {
          log_entries = msg.entries || [];
          renderLogs();
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setTimeout(connectWs, 2000);
    };
  }

  function fetchConfig() {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        file_paths = data.file_paths || [];
        renderFileList();
        if (active_file && !file_paths.includes(active_file)) {
          active_file = file_paths[0] || null;
          selectFile(active_file);
        }
        if (!active_file && file_paths.length) {
          active_file = file_paths[0];
          selectFile(active_file);
        }
      })
      .catch(() => {});
  }

  function renderFileList() {
    updateEmptyState();
    $file_list.innerHTML = file_paths
      .map(
        (fp) => `
        <li class="file_item ${fp === active_file ? 'active' : ''}" data-path="${escapeHtml(fp)}">
          <span class="path_text" title="${escapeHtml(fp)}">${escapeHtml(fp)}</span>
          <button type="button" class="remove_btn" title="Remove">×</button>
        </li>
      `
      )
      .join('');

    $file_list.querySelectorAll('.file_item').forEach((el) => {
      const path_val = el.getAttribute('data-path');
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('remove_btn')) {
          selectFile(path_val);
        }
      });
      const remove_btn = el.querySelector('.remove_btn');
      if (remove_btn) {
        remove_btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removePath(path_val);
        });
      }
    });
  }

  function selectFile(file_path) {
    if (!file_path) return;
    active_file = file_path;
    log_entries = [];
    renderFileList();
    renderLogs();

    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'select', file_path }));
    } else if (ws && ws.readyState === 0) {
      ws.addEventListener(
        'open',
        () => {
          ws.send(JSON.stringify({ type: 'select', file_path }));
        },
        { once: true }
      );
    }
  }

  function addPath(path_val) {
    const trimmed = path_val.trim();
    if (!trimmed) return;

    $add_path_error.textContent = '';

    fetch('/api/config/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: trimmed }),
    })
      .then((r) =>
        r.json().then((data) => ({ ok: r.ok, status: r.status, data }))
      )
      .then(({ ok, status, data }) => {
        if (!ok || data.error) {
          $add_path_error.textContent =
            data.error || `Request failed (status ${status})`;
          return;
        }
        file_paths = data.file_paths || [];
        renderFileList();
        closeAddPathModal();
        const added_path = data.file_paths[data.file_paths.length - 1];
        if (added_path) {
          selectFile(added_path);
        }
      })
      .catch((err) => {
        $add_path_error.textContent = err.message || 'Failed to add path';
      });
  }

  function removePath(path_val) {
    fetch('/api/config/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path_val }),
    })
      .then((r) => r.json())
      .then((data) => {
        file_paths = data.file_paths || [];
        if (active_file === path_val) {
          active_file = file_paths[0] || null;
          log_entries = [];
          selectFile(active_file);
        }
        renderFileList();
        renderLogs();
      })
      .catch(() => {});
  }

  function openAddPathModal() {
    $add_path_overlay.hidden = false;
    $new_path_input.value = '';
    $add_path_error.textContent = '';
    $new_path_input.focus();
  }

  function closeAddPathModal() {
    $add_path_overlay.hidden = true;
  }

  function openModal(entry) {
    selected_entry_for_modal = entry;
    $modal_content.textContent = JSON.stringify(entry, null, 2);
    $modal_overlay.hidden = false;
  }

  function closeModal() {
    $modal_overlay.hidden = true;
    selected_entry_for_modal = null;
  }

  function copySelectedLog() {
    if (!selected_entry_for_modal) return;
    const text = JSON.stringify(selected_entry_for_modal, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      $copy_log_btn.textContent = 'Copied!';
      setTimeout(() => {
        $copy_log_btn.textContent = 'Copy';
      }, 1500);
    });
  }

  function downloadVisibleLogs() {
    const filtered = log_entries.filter(matchesFilters);
    const text = filtered.map((e) => JSON.stringify(e)).join('\n');
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${active_file ? active_file.split('/').pop() : 'export'}_${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  $add_path_btn.addEventListener('click', openAddPathModal);

  $confirm_add_btn.addEventListener('click', () => {
    addPath($new_path_input.value);
  });

  $cancel_add_btn.addEventListener('click', closeAddPathModal);

  $new_path_input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPath($new_path_input.value);
    if (e.key === 'Escape') closeAddPathModal();
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

  $log_body.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (!row) return;
    const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
    const entry = log_entries[raw_idx];
    if (entry) openModal(entry);
  });

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  document.getElementById('download_btn').addEventListener('click', downloadVisibleLogs);

  fetchConfig();
  connectWs();
})();
