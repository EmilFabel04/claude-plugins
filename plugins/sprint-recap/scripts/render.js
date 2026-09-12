#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { loadConfig } = require('./lib/config');
const { validateRecap, ValidationError } = require('./lib/validate');
const { layoutCard } = require('./lib/layout');
const state = require('./lib/state');
const gitlib = require('./lib/git');
const { measure } = require('./lib/measure');

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), width: null, maxRows: null, noGit: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') opts.cwd = argv[++i];
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--max-rows') opts.maxRows = Number(argv[++i]);
    else if (a === '--no-git') opts.noGit = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return opts;
}

function elapsedLabel(startedAt, now) {
  const mins = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Load or create the sprint state for the cwd and measure the sprint so far.
function measureSprint(cwd, now) {
  const ctx = state.resolveCwd(cwd);
  let st = null;
  try { st = state.readState(ctx.key); } catch { st = null; }
  if (!st) {
    const head = ctx.git ? gitlib.head(ctx.root) : null;
    st = state.freshState({ root: ctx.root, git: ctx.git, head, baseline: {}, now });
  }
  if (state.isHomeOrRoot(ctx.root)) {
    const elapsed = elapsedLabel(st.sprint.started_at, now);
    return { ctx, st, changes: null, meta: { elapsed, files: 0 } };
  }
  const changes = measure(ctx.root, {
    git: st.git, head: st.sprint.head, baseline: st.sprint.baseline, started_at: st.sprint.started_at,
  });
  const elapsed = changes.baselineLost ? 'baseline lost' : elapsedLabel(st.sprint.started_at, now);
  return { ctx, st, changes, meta: { elapsed, files: changes.files } };
}

function commit({ ctx, st }, recap, changes, card, now) {
  const skip = state.isHomeOrRoot(ctx.root);
  const head = skip ? null : st.git ? gitlib.head(ctx.root) : null;
  const baseline = skip ? {} : st.git ? gitlib.snapshot(ctx.root, head) : {};
  state.writeHistory({ rendered_at: now.toISOString(), cwd: ctx.root, recap, changes, card }, ctx.root, now);
  if (st.turn) st.turn.recap_rendered_at = now.toISOString();
  st.sprint = state.newSprint({ head, baseline, now });
  state.writeState(ctx.key, st);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const now = new Date();

  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch (e) { throw new ValidationError('stdin', `not valid JSON (${e.message})`); }
  const recap = validateRecap(input, { questions: config.questions });

  const sprint = opts.noGit ? null : measureSprint(opts.cwd, now);
  const changes = sprint ? sprint.changes : null;
  const meta = sprint ? sprint.meta : { elapsed: '0m', files: 0 };

  const rows = layoutCard({
    recap, changes, meta,
    width: opts.width || config.width,
    maxRows: opts.maxRows || config.maxRows,
  });
  const card = rows.join('\n');
  process.stdout.write(card + '\n');

  if (sprint && !opts.dryRun) commit(sprint, recap, changes, card, now);
}

try {
  main();
} catch (e) {
  process.stderr.write(`sprint-recap: ${(e && e.message) || String(e)}\n`);
  process.exit(1);
}
