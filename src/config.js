import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = process.env.CPANEL_DEPLOY_HOME || path.join(os.homedir(), '.cpanel-deploy');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const EMPTY = { version: 1, profiles: {}, github: {} };

export function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...EMPTY, ...raw, profiles: raw.profiles || {}, github: raw.github || {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function save(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    /* Windows ignores POSIX modes */
  }
}

export function profileNames(cfg) {
  return Object.keys(cfg.profiles).sort();
}

export function getProfile(cfg, name) {
  return cfg.profiles[name] ? { name, ...cfg.profiles[name] } : null;
}

export function putProfile(cfg, profile) {
  const { name, ...rest } = profile;
  cfg.profiles[name] = rest;
  save(cfg);
}

export function removeProfile(cfg, name) {
  delete cfg.profiles[name];
  save(cfg);
}

export function displayPath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
