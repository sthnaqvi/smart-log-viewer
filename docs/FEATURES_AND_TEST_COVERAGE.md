# Smart Log Viewer – Features & Test Coverage

## Feature List

### Core Features (from README)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Source tagging | Functionality | Tag each log source with name and color |
| 2 | Add source | Functionality | Add log file path, tag name, color |
| 3 | Remove source | Functionality | Remove source from config |
| 4 | Edit source | Functionality | Rename tag, change color |
| 5 | Focus source | Functionality | Click source to filter logs to that source only |
| 6 | Persistence | Functionality | Sources saved to config.json, loaded on restart |
| 7 | Real-time streaming | Functionality | WebSocket-based, tail -F, no polling |
| 8 | Visible sources toggle | Functionality | Toggle which sources' logs are shown |
| 9 | Structured JSON parsing | Functionality | Parse JSON logs; malformed lines → raw fallback |
| 10 | Level filter | Functionality | Filter by ERROR, WARN, INFO, DEBUG |
| 11 | Text search filter | Functionality | Search across log entry |
| 12 | Pause | Functionality | Pause new log ingestion |
| 13 | Clear | Functionality | Clear displayed logs |
| 14 | Level badges | UI | ERROR, WARN, INFO, DEBUG with colored badges |
| 15 | Hover tooltips | UI | Full value on hover for truncated cells |
| 16 | Click to expand | Functionality | Click truncated cell → Full Value modal |
| 17 | Click row | Functionality | Click row → JSON modal |
| 18 | Auto-scroll toggle | Functionality | Auto-scroll to bottom |
| 19 | Copy log | Functionality | Copy JSON from modal |
| 20 | Download visible logs | Functionality | Download filtered logs as JSONL |
| 21 | Performance | Functionality | 2000-row cap, alternating rows |
| 22 | Dark theme | UI | Sidebar, topbar, log table |

### UX Fixes (from prompts)

| # | Fix | Type | Description |
|---|-----|------|-------------|
| 23 | Long message truncation | UI | Full content in floating tooltip on hover |
| 24 | Source identity | UI | Stronger tag badges (padding), row tint 5% opacity |
| 25 | Message readability | UI | INFO lighter, ERROR bold, DEBUG dim, SQL monospace + code-block |
| 26 | Toolbar layout | UI | Three zones (left/center/right) with separators |
| 27 | Click affordance | UI | Expand icon ▸, hover effect, cursor pointer |
| 28 | Column width | UI | Fixed widths for Timestamp/Level/File:Line, Message flexible |
| 29 | Sticky header | UI | Shadow when scrolling |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/config | GET | Returns sources |
| /api/config/add | POST | Add source, start tail |
| /api/config/update | POST | Update tag/color |
| /api/config/remove | POST | Remove source, stop tail |

### WebSocket

| Message | Direction | Description |
|---------|-----------|-------------|
| select | Client→Server | Request buffer for file_path |
| buffer | Server→Client | Initial log entries |
| log | Server→Client | New log entry (streaming) |

---

## Test Coverage Matrix

| Feature | e2e.js | ui.spec.js | feature-tests.spec.js |
|---------|--------|------------|------------------------|
| 1 | ✓ | ✓ | ✓ |
| 2 | ✓ | ✓ | ✓ |
| 3 | ✓ | | ✓ |
| 4 | | | ✓ |
| 5 | | | ✓ |
| 6 | | | ✓ |
| 7 | ✓ | ✓ | ✓ |
| 8 | | | ✓ |
| 9 | | | ✓ |
| 10 | | | ✓ |
| 11 | | | ✓ |
| 12 | | | ✓ |
| 13 | | | ✓ |
| 14 | | ✓ | ✓ |
| 15 | | ✓ | ✓ |
| 16 | | | ✓ |
| 17 | ✓ | ✓ | ✓ |
| 18 | | ✓ | ✓ |
| 19 | | | ✓ |
| 20 | | ✓ | ✓ |
| 21 | | | ✓ |
| 22 | | ✓ | ✓ |
| 23–29 | | ✓ | ✓ |

---

## Test Suites Summary

| Suite | Command | Coverage |
|-------|---------|----------|
| e2e | `npm run test:api` | API + WebSocket, add, remove, streaming, invalid path |
| ui | `npm run test:ui` | Flow, tooltips, source identity, message styling, toolbar, columns, sticky header |
| feature-tests | `npm run test:features` | Config, filters, pause, edit, modals, persistence |

### ui.spec.js (49 tests)
- Flow: logs display, streaming, modals
- Tooltips: data-full, truncation, hover
- Source identity: tag badge padding, row tint
- Message styling: ERROR/INFO/DEBUG/SQL
- Toolbar layout: zones, separators
- Click affordance: expand icon, cursor
- Table columns: fixed layout, widths
- Sticky header: scroll, shadow

### feature-tests.spec.js (25 tests)
- API: Config update (tag, color)
- API: Config remove
- Malformed JSON parsing (raw fallback)
- Config persistence (restart)
- UI: Level filter
- UI: Text search
- UI: Tag visibility toggle
- UI: Pause / Resume
- UI: Clear
- UI: Click truncated cell → Full Value modal
- UI: Click row → JSON modal
- UI: Copy / Download buttons
- UI: Edit source
- UI: Invalid path error
- UI: Empty state
