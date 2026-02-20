const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const CONFIG_DIR =
  process.env.CONFIG_DIR || path.join(os.homedir(), '.smart-log-viewer');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_COLORS = [
  '#a371f7',
  '#58a6ff',
  '#3fb950',
  '#d29922',
  '#f85149',
  '#79c0ff',
  '#ff7b72',
  '#a5d6ff',
];

function tagFromPath(file_path) {
  const base = path.basename(file_path);
  const name = base.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return name || base || 'log';
}

function pickColor(existing_colors) {
  const used = new Set(existing_colors.map((c) => c.toLowerCase()));
  for (const c of DEFAULT_COLORS) {
    if (!used.has(c.toLowerCase())) return c;
  }
  return DEFAULT_COLORS[existing_colors.length % DEFAULT_COLORS.length];
}

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
    return migrateConfig(config);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sources: [] };
    }
    throw new Error(`Failed to read config: ${err.message}`);
  }
}

function migrateConfig(config) {
  if (Array.isArray(config.sources) && config.sources.length > 0) {
    return config;
  }
  const legacy_paths = config.file_paths || [];
  const sources = legacy_paths.map((fp, i) => {
    const normalized = path.normalize(String(fp).trim());
    return {
      path: normalized,
      tagName: tagFromPath(normalized),
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    };
  });
  return { sources };
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

async function getSources() {
  const config = await readConfig();
  return config.sources || [];
}

async function getFilePaths() {
  const sources = await getSources();
  return sources.map((s) => s.path);
}

async function addSource(file_path, tag_name, color) {
  const config = await readConfig();
  const sources = config.sources || [];
  const normalized = path.normalize(file_path.trim());
  const existing = sources.find((s) => s.path === normalized);
  if (existing) return sources;

  const tag = (tag_name || tagFromPath(normalized)).trim() || tagFromPath(normalized);
  const existing_colors = sources.map((s) => s.color);
  const final_color = color || pickColor(existing_colors);

  config.sources = [...sources, { path: normalized, tagName: tag, color: final_color }];
  await writeConfig(config);
  return config.sources;
}

async function updateSource(file_path, updates) {
  const config = await readConfig();
  const sources = config.sources || [];
  const normalized = path.normalize(file_path.trim());
  const idx = sources.findIndex((s) => s.path === normalized);
  if (idx < 0) return sources;

  const updated = { ...sources[idx] };
  if (updates.tagName != null) updated.tagName = String(updates.tagName).trim() || updated.tagName;
  if (updates.color != null) updated.color = updates.color;
  sources[idx] = updated;
  config.sources = sources;
  await writeConfig(config);
  return config.sources;
}

async function removeSource(file_path) {
  const config = await readConfig();
  const sources = config.sources || [];
  const normalized = path.normalize(file_path.trim());
  config.sources = sources.filter((s) => s.path !== normalized);
  await writeConfig(config);
  return config.sources;
}

module.exports = {
  readConfig,
  writeConfig,
  getSources,
  getFilePaths,
  addSource,
  updateSource,
  removeSource,
  tagFromPath,
  pickColor,
  CONFIG_FILE,
};
