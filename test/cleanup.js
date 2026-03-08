#!/usr/bin/env node
'use strict';

/**
 * Removes test artifacts: legacy .test_* dirs at project root, and test/.tmp
 * Run before and after tests to ensure clean state.
 */

const fs = require('fs');
const path = require('path');

const project_root = path.join(__dirname, '..');

function cleanup() {
  const legacy_dirs = ['.test_config', '.test_temp', '.test_config_ext'];
  for (const name of legacy_dirs) {
    const dir = path.join(project_root, name);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    } catch (err) {
      console.warn('Could not remove', name, err.message);
    }
  }

  try {
    const entries = fs.readdirSync(project_root);
    for (const name of entries) {
      if (name.startsWith('.test_config_cli_')) {
        const dir = path.join(project_root, name);
        fs.rmSync(dir, { recursive: true });
      }
    }
  } catch (_) {}

  const test_tmp = path.join(__dirname, '.tmp');
  try {
    if (fs.existsSync(test_tmp)) {
      fs.rmSync(test_tmp, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not remove test/.tmp', err.message);
  }
}

cleanup();
