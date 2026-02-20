const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const CONFIG_DIR =
  process.env.CONFIG_DIR || path.join(os.homedir(), '.smart-log-viewer');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_CONFIG = { file_paths: [] };

async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create config directory: ${err.message}`);
  }
}

async function readConfig() {
  try {
    await ensureConfigDir();
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    return Array.isArray(config.file_paths) ? config : DEFAULT_CONFIG;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw new Error(`Failed to read config: ${err.message}`);
  }
}

async function writeConfig(config) {
  try {
    await ensureConfigDir();
    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(CONFIG_FILE, data, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to write config: ${err.message}`);
  }
}

async function getFilePaths() {
  const config = await readConfig();
  return config.file_paths || [];
}

async function addFilePath(file_path) {
  const config = await readConfig();
  const paths = config.file_paths || [];
  const normalized = path.normalize(file_path.trim());
  if (!normalized || paths.includes(normalized)) {
    return paths;
  }
  config.file_paths = [...paths, normalized];
  await writeConfig(config);
  return config.file_paths;
}

async function removeFilePath(file_path) {
  const config = await readConfig();
  const paths = config.file_paths || [];
  const normalized = path.normalize(file_path.trim());
  config.file_paths = paths.filter((p) => p !== normalized);
  await writeConfig(config);
  return config.file_paths;
}

module.exports = {
  readConfig,
  writeConfig,
  getFilePaths,
  addFilePath,
  removeFilePath,
  CONFIG_FILE,
};
