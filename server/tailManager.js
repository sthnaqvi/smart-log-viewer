const { spawn } = require('child_process');
const path = require('path');

const LOG_WINDOW_CAP = 2000;

class TailManager {
  constructor() {
    this._tails = new Map();
    this._log_buffers = new Map();
    this._broadcast_fn = null;
  }

  setBroadcast(broadcast_fn) {
    this._broadcast_fn = broadcast_fn;
  }

  _getBuffer(file_path) {
    if (!this._log_buffers.has(file_path)) {
      this._log_buffers.set(file_path, []);
    }
    return this._log_buffers.get(file_path);
  }

  _parseLogLine(line) {
    if (!line || typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (_) {
      // Malformed JSON - return raw line as fallback
      return { raw: trimmed, msg: trimmed };
    }
    return null;
  }

  _emit(file_path, entry) {
    const buffer = this._getBuffer(file_path);
    buffer.push(entry);
    if (buffer.length > LOG_WINDOW_CAP) {
      buffer.shift();
    }
    if (this._broadcast_fn) {
      this._broadcast_fn({ file_path, entry });
    }
  }

  _spawnTail(file_path) {
    if (this._tails.has(file_path)) {
      this.stopTail(file_path);
    }

    const tail = spawn('tail', ['-F', '-n', '100', file_path], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    tail.stdout.setEncoding('utf-8');
    tail.stderr.setEncoding('utf-8');

    let buffer = '';
    const flush = () => {
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        const entry = this._parseLogLine(line);
        if (entry) {
          this._emit(file_path, entry);
        }
      }
    };

    tail.stdout.on('data', (chunk) => {
      buffer += chunk;
      flush();
    });

    tail.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) {
        this._emit(file_path, { raw: msg, msg, lv: 'STDERR' });
      }
    });

    tail.on('error', (err) => {
      this._emit(file_path, {
        raw: err.message,
        msg: `Tail error: ${err.message}`,
        lv: 'ERROR',
      });
    });

    tail.on('exit', (code, signal) => {
      this._tails.delete(file_path);
      if (code !== 0 && code !== null) {
        this._emit(file_path, {
          raw: `Tail exited: ${code}`,
          msg: `Tail process exited (code: ${code}, signal: ${signal})`,
          lv: 'WARN',
        });
      }
    });

    this._tails.set(file_path, tail);
  }

  startTail(file_path) {
    const normalized = path.normalize(file_path);
    try {
      this._spawnTail(normalized);
      return true;
    } catch (err) {
      this._emit(normalized, {
        raw: err.message,
        msg: `Failed to start tail: ${err.message}`,
        lv: 'ERROR',
      });
      return false;
    }
  }

  stopTail(file_path) {
    const normalized = path.normalize(file_path);
    const tail = this._tails.get(normalized);
    if (tail) {
      tail.kill('SIGTERM');
      this._tails.delete(normalized);
    }
  }

  stopAll() {
    for (const [fp, tail] of this._tails) {
      tail.kill('SIGTERM');
    }
    this._tails.clear();
  }

  getBuffer(file_path) {
    return this._getBuffer(path.normalize(file_path)).slice();
  }

  hasTail(file_path) {
    return this._tails.has(path.normalize(file_path));
  }
}

module.exports = { TailManager, LOG_WINDOW_CAP };
