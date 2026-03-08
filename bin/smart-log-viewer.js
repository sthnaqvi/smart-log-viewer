#!/usr/bin/env node

'use strict';

const path = require('path');
const os = require('os');
const minimist = require('minimist');

const HELP = `
Smart Log Viewer - Real-time structured log viewer for developers

Usage:
  smart-log-viewer [options]

Options:
  --port <n>     Port to listen on (default: 3847)
  --config <path> Config directory (default: ~/.smart-log-viewer)
  --no-open      Do not open browser automatically
  --help, -h     Show this help

Examples:
  smart-log-viewer
  smart-log-viewer --port 9000
  smart-log-viewer --config ~/my-config --no-open
`;

function parse_args() {
  const argv = minimist(process.argv.slice(2), {
    string: ['port', 'config'],
    boolean: ['open', 'help'],
    default: { open: true },
    alias: { h: 'help' },
  });

  if (argv.help) {
    console.log(HELP.trim());
    process.exit(0);
  }

  let port = parseInt(argv.port || process.env.PORT || '3847', 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error('Invalid port. Use a number between 1 and 65535.');
    process.exit(1);
  }
  const config_dir = argv.config
    ? path.resolve(argv.config.replace(/^~/, os.homedir()))
    : path.join(os.homedir(), '.smart-log-viewer');
  const open_browser = argv.open !== false && !argv['no-open'];
  const user_specified_port = argv.port != null;

  return { port, config_dir, open_browser, user_specified_port };
}

async function main() {
  let { port, config_dir, open_browser, user_specified_port } = parse_args();

  process.env.PORT = String(port);
  process.env.CONFIG_DIR = config_dir;

  const chalk = require('chalk');
  const config_path = path.join(config_dir, 'config.json');

  const is_tty = process.stdout.isTTY === true;

  function log(msg) {
    if (is_tty) console.log(msg);
  }

  function log_success(msg) {
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

  for (let attempt = 0; attempt < max_port_attempts; attempt++) {
    const try_port = port + attempt;
    process.env.PORT = String(try_port);
    try {
      const result = await startServer();
      server = result.server;
      tail_manager = result.tail_manager;
      close_all = result.close_all;
      port = try_port;
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

  log_success('Server started');
  log_success('Watching logs');
  log_success('UI available at ' + chalk.cyan(`http://localhost:${port}`));
  log('');

  if (open_browser && is_tty) {
    const { default: open } = await import('open');
    open(`http://localhost:${port}`).catch(() => {});
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
}

function format_start_error(err) {
  if (err.code === 'EADDRINUSE') {
    const port_match = err.message.match(/:(\d+)/);
    const port_str = port_match ? port_match[1] : 'port';
    return `Port ${port_str} is already in use. Try: smart-log-viewer --port <different-port>`;
  }
  return err.message || 'Failed to start';
}

main().catch((err) => {
  console.error('Failed to start:', format_start_error(err));
  process.exit(1);
});
