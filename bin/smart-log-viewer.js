#!/usr/bin/env node

'use strict';

const path = require('path');
const os = require('os');
const { program } = require('commander');

function getVersion() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    return pkg.version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function resolveConfigDir(raw_path) {
  const expanded = raw_path.replace(/^~/, os.homedir());
  return path.resolve(expanded);
}

function getDefaultConfigDir() {
  return path.join(os.homedir(), '.smart-log-viewer');
}

function parsePort(value, default_val = 3847) {
  const port = parseInt(value || process.env.PORT || String(default_val), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port. Use a number between 1 and 65535.');
  }
  return port;
}

program
  .name('smart-log-viewer')
  .description('Smart Log Viewer - Production-quality real-time structured log viewer for developers')
  .version(getVersion(), '-v, --version', 'Show version')
  .helpOption('-h, --help', 'Show help')
  .option('-p, --port <n>', 'Port to listen on', '3847')
  .option('-c, --config <path>', 'Config directory', getDefaultConfigDir())
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options) => {
    const port_raw = (process.argv.includes('--port') || process.argv.includes('-p'))
      ? options.port
      : (process.env.PORT || options.port);
    const port = parsePort(port_raw, 3847);
    const config_dir = (options.config || '').startsWith('~')
      ? resolveConfigDir(options.config)
      : (options.config || getDefaultConfigDir());
    const open_browser = options.open !== false;
    const user_specified_port = process.argv.includes('--port') || process.argv.includes('-p');

    process.env.PORT = String(port);
    process.env.CONFIG_DIR = config_dir;

    const chalk = require('chalk');
    const config_path = path.join(config_dir, 'config.json');
    const is_tty = process.stdout.isTTY === true;

    function log(msg) {
      if (is_tty) console.log(msg);
    }

    function logSuccess(msg) {
      if (is_tty) console.log(chalk.green('✔') + ' ' + msg);
      else console.log(msg);
    }

    log('');
    log(chalk.bold('Smart Log Viewer'));
    log(chalk.dim('Config:') + ' ' + config_path);
    log(chalk.dim('Port:') + ' ' + port);
    log('');

    const { startServer } = require('../server/server');

    const max_port_attempts = 5;
    let server = null;
    let tail_manager = null;
    let close_all = null;
    let last_error = null;
    let actual_port = port;

    for (let attempt = 0; attempt < max_port_attempts; attempt++) {
      const try_port = port + attempt;
      process.env.PORT = String(try_port);
      try {
        const result = await startServer();
        server = result.server;
        tail_manager = result.tail_manager;
        close_all = result.close_all;
        actual_port = try_port;
        break;
      } catch (err) {
        last_error = err;
        const can_retry = !user_specified_port && err.code === 'EADDRINUSE' &&
          attempt < max_port_attempts - 1;
        if (can_retry) {
          log(chalk.yellow(`Port ${try_port} in use, trying ${try_port + 1}...`));
          continue;
        }
        throw err;
      }
    }

    if (!server || !tail_manager) {
      throw last_error || new Error('Failed to start server');
    }

    logSuccess('Server started');
    logSuccess('Watching logs');
    logSuccess('UI available at ' + chalk.cyan(`http://localhost:${actual_port}`));
    log('');

    if (open_browser && is_tty) {
      const { default: open } = await import('open');
      open(`http://localhost:${actual_port}`).catch(() => {});
    }

    let is_shutting_down = false;
    function shutdown() {
      if (is_shutting_down) {
        process.exit(1);
      }
      is_shutting_down = true;
      tail_manager.stopAll();
      if (close_all) close_all();
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('config')
  .description('Show config directory path')
  .option('-c, --config <path>', 'Config directory', getDefaultConfigDir())
  .action((options) => {
    const config_dir = (options.config || '').startsWith('~')
      ? resolveConfigDir(options.config)
      : (options.config || getDefaultConfigDir());
    console.log(config_dir);
  });

program
  .command('info')
  .description('Show version, config path, and environment info')
  .option('-c, --config <path>', 'Config directory', getDefaultConfigDir())
  .action((options) => {
    const config_dir = (options.config || '').startsWith('~')
      ? resolveConfigDir(options.config)
      : (options.config || getDefaultConfigDir());
    const config_path = path.join(config_dir, 'config.json');
    console.log('Smart Log Viewer');
    console.log('Version:', getVersion());
    console.log('Config directory:', config_dir);
    console.log('Config file:', config_path);
    console.log('Node:', process.version);
  });

function formatStartError(err) {
  if (err.code === 'EADDRINUSE') {
    const port_match = err.message.match(/:(\d+)/);
    const port_str = port_match ? port_match[1] : 'port';
    return `Port ${port_str} is already in use. Try: smart-log-viewer --port <different-port>`;
  }
  if (err.message && (err.message.startsWith('error:') || err.message.includes('unknown'))) {
    return err.message;
  }
  return err.message || 'Failed to start';
}

program.parseAsync().catch((err) => {
  console.error(formatStartError(err));
  process.exit(1);
});
