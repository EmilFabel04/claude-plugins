#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const state = require('./lib/state');
const gitlib = require('./lib/git');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function main() {
  const input = readInput();
  const cwd = input.cwd || process.cwd();
  const now = new Date();
  const ctx = state.resolveCwd(cwd);

  let st = null;
  try { st = state.readState(ctx.key); }
  catch (e) { state.logHookError('stamp-turn', e); st = null; }

  const skip = state.isHomeOrRoot(ctx.root);
  const head = skip ? null : ctx.git ? gitlib.head(ctx.root) : null;
  const baseline = skip ? {} : ctx.git ? gitlib.snapshot(ctx.root, head) : {};
  if (!st) st = state.freshState({ root: ctx.root, git: ctx.git, head, baseline, now });

  st.turn = { started_at: now.toISOString(), head, baseline, recap_rendered_at: null };
  if (skip) st.turn.skip = true;
  state.writeState(ctx.key, st);
}

try { main(); } catch (e) { state.logHookError('stamp-turn', e); }
process.exit(0);
