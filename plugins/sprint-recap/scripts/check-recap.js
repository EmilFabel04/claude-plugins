#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const state = require('./lib/state');
const { loadConfig } = require('./lib/config');
const { measure } = require('./lib/measure');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

// Returns the block payload, or null to allow. First matching rule wins.
function decide(input, config) {
  if (input.stop_hook_active) return null;                                     // 1

  const ctx = state.resolveCwd(input.cwd || process.cwd());
  const st = state.readState(ctx.key);
  if (!st || !st.turn || st.turn.skip) return null;                           // 2

  const ch = measure(ctx.root, {
    git: st.git, head: st.turn.head, baseline: st.turn.baseline, started_at: st.turn.started_at,
  });
  const lines = ch.added + ch.removed;
  const quiet = ch.git
    ? ch.files < config.minFiles && lines < config.minLines
    : ch.files < config.minFiles;
  if (quiet || ch.capped) return null;                                         // 3

  if (st.turn.recap_rendered_at) return null;                                  // 4

  const counts = ch.git ? `${ch.files} files (+${ch.added} -${ch.removed})` : `${ch.files} files`;
  return {                                                                     // 5
    decision: 'block',
    reason: `sprint-recap: ${counts} changed this turn and no recap card has been rendered. `
      + 'Invoke the sprint-recap skill with the Skill tool and render the card before finishing.',
  };
}

function main() {
  const result = decide(readInput(), loadConfig());
  if (result) process.stdout.write(JSON.stringify(result) + '\n');
}

try { main(); } catch (e) { state.logHookError('check-recap', e); }
process.exit(0);
