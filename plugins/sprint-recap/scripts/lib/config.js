'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS_PATH = path.join(__dirname, '..', 'defaults.json');

// All runtime state lives here. Tests point SPRINT_RECAP_HOME at a temp dir.
function baseDir() {
  return process.env.SPRINT_RECAP_HOME || path.join(os.homedir(), '.claude', 'sprint-recap');
}

const POSITIVE_INT_KEYS = ['minFiles', 'minLines', 'width', 'maxRows', 'questions'];

function loadConfig() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  const userPath = path.join(baseDir(), 'config.json');
  let user = {};
  if (fs.existsSync(userPath)) {
    try { user = JSON.parse(fs.readFileSync(userPath, 'utf8')); }
    catch (e) { throw new Error(`config.json: ${e.message}`); }
  }
  const merged = { ...defaults, ...user };
  for (const key of POSITIVE_INT_KEYS) {
    if (!Number.isInteger(merged[key]) || merged[key] <= 0) {
      throw new Error(`config.json: ${key} must be a positive integer`);
    }
  }
  return merged;
}

module.exports = { baseDir, loadConfig, DEFAULTS_PATH };
