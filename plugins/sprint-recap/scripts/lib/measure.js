'use strict';
const fs = require('node:fs');
const path = require('node:path');
const gitlib = require('./git');

const MAX_DEPTH = 4;
const MAX_ENTRIES = 5000;

// Files under root modified after sinceMs, as { relpath: [0, 0] } so they
// group like git results. Line counts are unknown outside git.
function scanMtime(root, sinceMs, { maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES } = {}) {
  const files = {};
  let seen = 0;
  let capped = false;
  const walk = (dir, depth) => {
    if (capped || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > maxEntries) { capped = true; return; }
      if (e.name.startsWith('.') || gitlib.SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile()) {
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (st.mtimeMs > sinceMs) files[path.relative(root, full).split(path.sep).join('/')] = [0, 0];
      }
    }
  };
  walk(root, 1);
  return { files, capped };
}

function summarise(files, extra) {
  const groups = gitlib.groupChanges(files);
  return {
    files: Object.keys(files).length,
    added: groups.reduce((s, x) => s + x.added, 0),
    removed: groups.reduce((s, x) => s + x.removed, 0),
    groups,
    ...extra,
  };
}

// Shared by the renderer (sprint scope) and the Stop hook (turn scope).
function measure(root, scope) {
  if (scope.git) {
    const baselineLost = Boolean(scope.head) && !gitlib.refExists(root, scope.head);
    const ref = baselineLost ? gitlib.head(root) : scope.head;
    const current = gitlib.snapshot(root, ref);
    const files = gitlib.delta(current, baselineLost ? {} : scope.baseline || {});
    return summarise(files, { git: true, baselineLost, capped: false });
  }
  const { files, capped } = scanMtime(root, Date.parse(scope.started_at));
  return summarise(files, { git: false, baselineLost: false, capped });
}

module.exports = { scanMtime, measure };
