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
  const $time_filter = document.getElementById('time_filter');
  const $text_search = document.getElementById('text_search');
  const $auto_scroll = document.getElementById('auto_scroll');
  const $volume_graph = document.getElementById('volume_graph');
  const $palette_overlay = document.getElementById('command_palette_overlay');
  const $palette_input = document.getElementById('palette_input');
  const $palette_list = document.getElementById('palette_list');
  
  let focused_row_idx = -1;
  let palette_idx = -1;
  let palette_options = [];
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
  const $chat_panel = document.getElementById('chat_panel');
  const $chat_messages = document.getElementById('chat_messages');
  const $chat_input = document.getElementById('chat_input');
  const $ai_chat_btn = document.getElementById('ai_chat_btn');
  const $send_chat_btn = document.getElementById('send_chat_btn');
  const $close_chat_btn = document.getElementById('close_chat_btn');

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
    const base = 'px-2 rounded text-[11px] inline-flex items-center h-[22px] border font-mono tracking-wider ';
    if (lv === 'ERROR') return base + 'bg-red-500/10 text-red-500 border-red-500/20';
    if (lv === 'WARN') return base + 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    if (lv === 'INFO') return base + 'bg-green-500/10 text-green-500 border-green-500/20';
    if (lv === 'DEBUG') return base + 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    if (lv === 'SQL') return base + 'bg-[#ff6200]/10 text-[#ff6200] border-[#ff6200]/20';
    return base + 'bg-white/10 text-white/50 border-white/20';
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

    const time_val = $time_filter.value;
    if (time_val && entry.ts) {
      const entryTime = new Date(entry.ts).getTime();
      if (!isNaN(entryTime)) {
        const now = Date.now();
        let limit = 0;
        if (time_val === '5m') limit = 5 * 60 * 1000;
        else if (time_val === '15m') limit = 15 * 60 * 1000;
        else if (time_val === '1h') limit = 60 * 60 * 1000;
        else if (time_val === '6h') limit = 6 * 60 * 60 * 1000;
        else if (time_val === '24h') limit = 24 * 60 * 60 * 1000;
        
        if (now - entryTime > limit) return false;
      }
    }

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
        const trClass = row_class ? 'bg-surface-container-low/20' : '';
        const levelIcon = lv === 'ERROR' ? '<span class="w-1.5 h-1.5 rounded-full bg-error shadow-[0_0_8px_rgba(255,110,132,0.8)]"></span>' : '';
        
        return `
          <tr class="log_row group cursor-pointer hover:bg-white/5 transition-colors border-b border-white/5" data-index="${idx}" data-raw-index="${raw_idx}">
            <td class="col_expand py-2.5 px-3 text-center align-middle"><span class="row_expand_icon material-symbols-outlined text-sm text-white/10 group-hover:text-white/50 transition-colors cursor-pointer">chevron_right</span></td>
            <td class="col_tag py-2.5 px-2 align-middle"><span class="tag_badge px-2 py-[2px] rounded text-[9px] font-bold uppercase overflow-hidden text-ellipsis whitespace-nowrap inline-block max-w-full opacity-80" style="background: color-mix(in srgb, ${escapeHtml(color)} 20%, transparent); color: ${escapeHtml(color)}">${escapeHtml(tag)}</span></td>
            <td class="col_ts py-2.5 px-2 text-white/40 font-mono tracking-wide align-middle text-[11px]"><span class="cell_truncate" data-full="${escapeHtml(ts)}">${escapeHtml(ts)}</span></td>
            <td class="col_level py-2.5 px-2 align-middle"><span class="${level_class}">${escapeHtml(lv || '-')}</span></td>
            <td class="col_file py-2.5 px-2 text-white/30 text-[11px] font-mono align-middle"><span class="cell_truncate" data-full="${escapeHtml(fl)}">${escapeHtml(fl.length > 55 ? fl.slice(0, 52) + '...' : fl)}</span></td>
            <td class="col_msg py-2.5 px-4 align-middle w-full">
              <div class="cell_truncate msg_cell font-mono text-[12px] leading-relaxed ${msg_level === 'msg_error' ? 'text-[#ff2a00] font-bold underline decoration-[#ff2a00]/40 decoration-[2px] underline-offset-4' : msg_level === 'msg_info' ? 'text-white/80' : msg_level === 'msg_debug' ? 'text-white/40' : 'text-white/60'} ${msg_sql === 'msg_sql' ? 'text-white border-l-2 border-[#ff6200] pl-4 py-1 bg-white/5 italic rounded-r block my-0.5' : ''}" data-full="${escapeHtml(msg)}" data-level="${escapeHtml(lv)}">${escapeHtml(msg_display)}</div>
            </td>
          </tr>
        `;
      })
      .join('');

    bindCellTooltips();
    bindRowClicks();

    if ($auto_scroll.checked) {
      const container = document.querySelector('.log_container');
      // Only auto-scroll if we are already near the bottom, or just scroll smoothly.
      if (container) {
         container.scrollTo({
           top: container.scrollHeight,
           behavior: 'smooth'
         });
      }
    }
    drawVolumeGraph(capped);
  }

  function highlightFocusedRow() {
    document.querySelectorAll('.log_row.focused').forEach(el => el.classList.remove('focused'));
    if (focused_row_idx >= 0 && focused_row_idx < $log_body.children.length) {
      const row = $log_body.children[focused_row_idx];
      row.classList.add('focused');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function togglePreviewRow(row) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('preview_row')) {
      next.remove();
      return;
    }
    const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
    const entry = log_entries[raw_idx];
    if (!entry) return;
    
    const preview = document.createElement('tr');
    preview.className = 'preview_row';
    const td = document.createElement('td');
    td.colSpan = 6;
    
    const content = document.createElement('div');
    content.className = 'preview_content';
    
    // Quick preview just shows stringified JSON or raw message based on structure
    const clean = { ...entry };
    delete clean._file_path;
    delete clean._source_tag;
    content.textContent = JSON.stringify(clean, null, 2);
    
    td.appendChild(content);
    preview.appendChild(td);
    row.after(preview);
  }

  function bindRowClicks() {
    if ($log_body._rowClick) return;
    $log_body._rowClick = true;
    $log_body.addEventListener('click', (e) => {
      const row = e.target.closest('tr.log_row');
      if (row) {
        focused_row_idx = Array.from($log_body.children).indexOf(row);
        highlightFocusedRow();
      }

      const cell = e.target.closest('.cell_truncate[data-full]');
      if (cell) {
        e.stopPropagation();
        const full = cell.getAttribute('data-full');
        if (full) showExpandModal(full);
        return;
      }
      
      if (!row) return;
      const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
      const entry = log_entries[raw_idx];
      if (entry) openModal(entry);
    });
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

  function drawVolumeGraph(entries) {
    if (!$volume_graph) return;
    const ctx = $volume_graph.getContext('2d');
    const wrap = $volume_graph.parentElement;
    $volume_graph.width = wrap.clientWidth;
    $volume_graph.height = wrap.clientHeight;
    
    ctx.clearRect(0, 0, $volume_graph.width, $volume_graph.height);
    if (!entries.length) return;

    const times = entries.map(e => new Date(e.ts).getTime()).filter(t => !isNaN(t));
    if (!times.length) return;

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeSpan = Math.max(maxTime - minTime, 1);
    
    const buckets = 60;
    const bucketSizes = new Array(buckets).fill(0);
    
    times.forEach(t => {
      let b = Math.floor(((t - minTime) / timeSpan) * buckets);
      if (b >= buckets) b = buckets - 1;
      bucketSizes[b]++;
    });

    const maxCount = Math.max(...bucketSizes, 1);
    const w = $volume_graph.width / buckets;
    
    bucketSizes.forEach((count, i) => {
      if (count === 0) return;
      const h = (count / maxCount) * ($volume_graph.height - 10);
      const x = i * w;
      const y = $volume_graph.height - h;
      ctx.fillStyle = 'rgba(137, 180, 250, 0.6)';
      ctx.fillRect(x + 1, y, w - 2, h);
    });
  }

  function renderJsonTree(obj, container) {
    if (typeof obj !== 'object' || obj === null) {
      const span = document.createElement('span');
      if (typeof obj === 'string') {
        span.className = 'json-string';
        span.textContent = '"' + obj + '"';
      } else if (typeof obj === 'number') {
        span.className = 'json-number';
        span.textContent = obj;
      } else if (typeof obj === 'boolean') {
        span.className = 'json-boolean';
        span.textContent = obj;
      } else {
        span.className = 'json-null';
        span.textContent = 'null';
      }
      container.appendChild(span);
      return;
    }

    const isArray = Array.isArray(obj);
    container.appendChild(document.createTextNode(isArray ? '[' : '{'));

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'json-children';
    
    let isEmpty = true;
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      isEmpty = false;
      const node = document.createElement('div');
      node.className = 'json-node';
      
      if (!isArray) {
        const keySpan = document.createElement('span');
        keySpan.className = 'json-key';
        keySpan.textContent = '"' + key + '": ';
        node.appendChild(keySpan);
      }
      
      const val = obj[key];
      if (typeof val === 'object' && val !== null) {
        const toggle = document.createElement('span');
        toggle.className = 'json-toggle';
        toggle.textContent = '▼';
        toggle.onclick = (e) => {
          e.stopPropagation();
          node.classList.toggle('json-collapsed');
          toggle.textContent = node.classList.contains('json-collapsed') ? '▶' : '▼';
        };
        node.insertBefore(toggle, node.firstChild);
      }
      
      renderJsonTree(val, node);
      childrenContainer.appendChild(node);
    }
    
    if (!isEmpty) {
      container.appendChild(childrenContainer);
    }
    
    container.appendChild(document.createTextNode(isArray ? ']' : '}'));
  }

  function showExpandModal(text) {
    try {
      const parsed = JSON.parse(text);
      $modal_content.innerHTML = '<div class="json-tree"></div>';
      renderJsonTree(parsed, $modal_content.firstChild);
    } catch (_) {
      $modal_content.textContent = text;
    }
    $modal_overlay.querySelector('h3').textContent = 'Full Value';
    $modal_overlay.hidden = false;
    selected_entry_for_modal = null;
  }

  function openModal(entry) {
    const clean = { ...entry };
    delete clean._file_path;
    delete clean._source_tag;
    selected_entry_for_modal = entry;
    
    $modal_content.innerHTML = '<div class="json-tree"></div>';
    renderJsonTree(clean, $modal_content.firstChild);
    
    $modal_overlay.querySelector('h3').textContent = 'Log Entry (JSON)';
    $modal_overlay.hidden = false;
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
      } catch (_) { }
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
      .catch(() => { });
  }

  function renderTagToggles() {
    if (sources.length === 0) {
      $visible_sources.innerHTML = '';
      return;
    }
    $visible_sources.innerHTML = '<span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mr-2">Visible Sources:</span>' + sources
      .map(
        (s) => `
      <label class="tag_toggle flex items-center gap-2 cursor-pointer group bg-surface-container-high hover:bg-surface-bright px-2 py-1 rounded border border-outline-variant/10 transition-colors" title="Toggle ${escapeHtml(s.tagName)}">
        <input type="checkbox" class="sr-only" data-tag="${escapeHtml(s.tagName)}" checked>
        <span class="tag_toggle_badge px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition-opacity" style="color: ${escapeHtml(s.color)}; background: color-mix(in srgb, ${escapeHtml(s.color)} 15%, transparent)">${escapeHtml(s.tagName)}</span>
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
        <li class="file_item flex items-center justify-between p-2 rounded-lg cursor-pointer group transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-white/5 ${s.path === focused_source ? 'bg-white/5 border-l-2 border-[#ff4500] shadow-[0_0_15px_rgba(255,69,0,0.2)]' : 'border-l-2 border-transparent text-on-surface-variant/70 hover:text-on-surface'}" data-path="${escapeHtml(s.path)}">
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${escapeHtml(s.color)}; box-shadow: 0 0 8px color-mix(in srgb, ${escapeHtml(s.color)} 60%, transparent);"></div>
            <span class="path_text text-[13px] font-medium truncate" title="${escapeHtml(s.path)}">${escapeHtml(s.tagName)}</span>
          </div>
          <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" class="edit_btn hover:text-primary p-1 rounded hover:bg-white/5 outline-none border-none cursor-pointer flex items-center justify-center transition-colors bg-transparent" title="Edit">
              <span class="material-symbols-outlined text-[14px]">edit</span>
            </button>
            <button type="button" class="remove_btn hover:text-error p-1 rounded hover:bg-white/5 outline-none border-none cursor-pointer flex items-center justify-center transition-colors bg-transparent" title="Remove">
              <span class="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
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
      .catch(() => { });
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
      .catch(() => { });
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

  function openPalette() {
    $palette_overlay.hidden = false;
    $palette_input.value = '';
    palette_idx = 0;
    
    // Build options
    palette_options = [
      { type: 'cmd', label: 'Clear Logs', action: () => { log_entries = []; renderLogs(); } },
      { type: 'cmd', label: 'Toggle Live Logs', action: () => { $auto_scroll.click(); } },
      { type: 'cmd', label: 'Toggle Pause', action: () => { $pause_btn.click(); } },
      { type: 'cmd', label: 'Download Visible Logs', action: downloadVisibleLogs },
      { type: 'cmd', label: 'Open AI Chat', action: openChatPanel }
    ];
    
    sources.forEach(s => {
      palette_options.push({ type: 'source', label: `Filter: Source ${s.tagName}`, action: () => setFocusedSource(s.path) });
    });
    
    renderPalette();
    $palette_input.focus();
  }

  function closePalette() {
    $palette_overlay.hidden = true;
  }

  function renderPalette() {
    const q = $palette_input.value.toLowerCase();
    const filtered = palette_options.filter(o => o.label.toLowerCase().includes(q));
    
    if (palette_idx >= filtered.length) palette_idx = Math.max(0, filtered.length - 1);
    
    $palette_list.innerHTML = filtered.map((o, i) => `
      <li class="palette_item ${i === palette_idx ? 'selected' : ''}" data-index="${i}">
        <span>${escapeHtml(o.label)}</span>
        <span class="palette_shortcut">${o.type.toUpperCase()}</span>
      </li>
    `).join('');
    
    $palette_list.querySelectorAll('.palette_item').forEach(el => {
      el.addEventListener('click', () => {
        filtered[parseInt(el.dataset.index, 10)].action();
        closePalette();
      });
      el.addEventListener('mouseenter', () => {
        palette_idx = parseInt(el.dataset.index, 10);
        Array.from($palette_list.children).forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    
    const sel = $palette_list.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  $palette_input.addEventListener('input', renderPalette);
  $palette_input.addEventListener('keydown', (e) => {
    const items = $palette_list.querySelectorAll('.palette_item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      palette_idx = (palette_idx + 1) % items.length;
      renderPalette();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      palette_idx = (palette_idx - 1 + items.length) % items.length;
      renderPalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = $palette_list.querySelector('.selected');
      if (sel) sel.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });

  $palette_overlay.addEventListener('click', (e) => {
    if (e.target === $palette_overlay) closePalette();
  });

  document.addEventListener('keydown', (e) => {
    // Command Palette Trigger: Cmd+K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }

    // Ignore other global shortcuts if focus is in an input or modal is open
    if (!$palette_overlay.hidden || !$modal_overlay.hidden || !$add_path_overlay.hidden || !$edit_tag_overlay.hidden) return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (focused_row_idx < $log_body.children.length - 1) {
        focused_row_idx++;
        highlightFocusedRow();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (focused_row_idx > 0) {
        focused_row_idx--;
        highlightFocusedRow();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focused_row_idx >= 0 && focused_row_idx < $log_body.children.length) {
        const row = $log_body.children[focused_row_idx];
        const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
        if (log_entries[raw_idx]) openModal(log_entries[raw_idx]);
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      if (focused_row_idx >= 0 && focused_row_idx < $log_body.children.length) {
        togglePreviewRow($log_body.children[focused_row_idx]);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      if (focused_row_idx >= 0 && focused_row_idx < $log_body.children.length) {
        const row = $log_body.children[focused_row_idx];
        const raw_idx = parseInt(row.getAttribute('data-raw-index'), 10);
        const entry = log_entries[raw_idx];
        if (entry) {
          e.preventDefault();
          const clean = { ...entry };
          delete clean._file_path;
          delete clean._source_tag;
          navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
        }
      }
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $auto_scroll.click();
    }
  });

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

  $time_filter.addEventListener('change', renderLogs);
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

  // ===== AI Chat Functions =====

  function getRecentLogsForContext() {
    // Get last 50 logs for context
    return log_entries.slice(-50);
  }

  function renderChatMessage(message, isUser) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat_message ${isUser ? 'user_message' : 'ai_message'}`;

    if (isUser) {
      messageDiv.innerHTML = `<div class="message_content">${escapeHtml(message)}</div>`;
    } else {
      // Convert markdown-like formatting to HTML for AI responses
      const formattedMessage = formatMarkdown(message);
      messageDiv.innerHTML = `<div class="message_content">${formattedMessage}</div>`;
    }

    $chat_messages.appendChild(messageDiv);
    $chat_messages.scrollTop = $chat_messages.scrollHeight;
  }

  function formatMarkdown(text) {
    // Simple markdown formatting
    let html = escapeHtml(text);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Lists
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[234]>)/g, '$1');
    html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<li>)/g, '$1');
    html = html.replace(/(<\/li>)<\/p>/g, '$1');

    return html;
  }

  async function sendChatMessage(message) {
    if (!message || !message.trim()) return;

    // Display user's message
    renderChatMessage(message, true);

    // Clear input and show loading
    $chat_input.value = '';
    $chat_input.disabled = true;
    $send_chat_btn.disabled = true;

    // Add loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat_message ai_message loading';
    loadingDiv.innerHTML = '<div class="message_content"><span class="loading_dots">Thinking...</span></div>';
    $chat_messages.appendChild(loadingDiv);
    $chat_messages.scrollTop = $chat_messages.scrollHeight;

    try {
      const recentLogs = getRecentLogsForContext();

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), recentLogs })
      });

      const data = await response.json();

      // Remove loading indicator
      loadingDiv.remove();

      if (data.error) {
        renderChatMessage(`Error: ${data.error}`, false);
      } else {
        renderChatMessage(data.response, false);
      }
    } catch (err) {
      loadingDiv.remove();
      renderChatMessage(`Failed to get response: ${err.message}`, false);
    } finally {
      $chat_input.disabled = false;
      $send_chat_btn.disabled = false;
      $chat_input.focus();
    }
  }

  function openChatPanel() {
    $chat_panel.hidden = false;
  }

  function closeChatPanel() {
    $chat_panel.hidden = true;
  }

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
    .catch(() => { });

  const log_container = document.querySelector('.log_container');
  const log_table = document.getElementById('log_table');
  if (log_container && log_table) {
    log_container.addEventListener('scroll', () => {
      log_table.classList.toggle('header_scrolled', log_container.scrollTop > 2);
    });
  }

  // ===== Chat Event Listeners =====
  $ai_chat_btn.addEventListener('click', openChatPanel);
  $close_chat_btn.addEventListener('click', closeChatPanel);
  $send_chat_btn.addEventListener('click', () => sendChatMessage($chat_input.value));
  $chat_input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage($chat_input.value);
    }
  });

  fetchConfig();
  connectWs();
})();
