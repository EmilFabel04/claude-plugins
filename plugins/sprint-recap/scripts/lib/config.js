'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS_PATH = path.join(__dirname, '..', 'defaults.json');

// All runtime state lives here. Tests point SPRINT_RECAP_HOME at a temp dir.
function baseDir() {
  return process.env.SPRINT_RECAP_HOME || path.join(os.homedir(), '.claude', 'sprint-recap');
}

function loadConfig() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  const userPath = path.join(baseDir(), 'config.json');
  const user = fs.existsSync(userPath) ? JSON.parse(fs.readFileSync(userPath, 'utf8')) : {};
  return { ...defaults, ...user };
}

module.exports = { baseDir, loadConfig, DEFAULTS_PATH };
