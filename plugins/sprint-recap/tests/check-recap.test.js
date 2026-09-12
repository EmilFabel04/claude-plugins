'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, tmpDir, makeHome, write, run } = require('./helpers');
const state = require('../scripts/lib/state');

function stamp(cwd, home, env = {}) {
  return run('stamp-turn.js', { input: JSON.stringify({ cwd }), env: { SPRINT_RECAP_HOME: home, ...env } });
}
function check(cwd, home, extra = {}, env = {}) {
  return run('check-recap.js', { input: JSON.stringify({ cwd, hook_event_name: 'Stop', stop_hook_active: false, ...extra }), env: { SPRINT_RECAP_HOME: home, ...env } });
}
function bigChange(repo) {
  write(repo, 'src/a.ts', Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
  write(repo, 'src/b.ts', Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n');
}
function setup() {
  const home = makeHome();
  const repo = initRepo();
  stamp(repo, home);
  return { home, repo };
}

test('rule 1: stop_hook_active allows even with a big change', () => {
  const { home, repo } = setup();
  bigChange(repo);
  const r = check(repo, home, { stop_hook_active: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop_hook_active allows even when config.json is corrupt', () => {
  const home = makeHome();
  const repo = initRepo();
  write(home, 'config.json', '{ not json');
  const r = check(repo, home, { stop_hook_active: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(path.join(home, 'hook-errors.log')), false);
});

test('rule 2: no state file allows', () => {
  const repo = initRepo();
  bigChange(repo);
  const r = check(repo, makeHome());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('rule 2: turn.skip allows', () => {
  const home = makeHome();
  const fakeHome = tmpDir();
  stamp(fakeHome, home, { HOME: fakeHome });
  bigChange(fakeHome);
  const r = check(fakeHome, home, {}, { HOME: fakeHome });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('rule 3: below both thresholds allows', () => {
  const { home, repo } = setup();
  write(repo, 'src/a.ts', 'one\ntwo\nthree\n');
  const r = check(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('rule 3: one file with many lines blocks', () => {
  const { home, repo } = setup();
  write(repo, 'src/a.ts', Array.from({ length: 25 }, (_, i) => `l${i}`).join('\n') + '\n');
  const r = check(repo, home);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^sprint-recap: 1 file \(\+25 -0\)/);
});

test('rule 4: recap already rendered allows', () => {
  const { home, repo } = setup();
  bigChange(repo);
  process.env.SPRINT_RECAP_HOME = home;
  const key = state.resolveCwd(repo).key;
  const st = state.readState(key);
  st.turn.recap_rendered_at = new Date().toISOString();
  state.writeState(key, st);
  const r = check(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('rule 5: blocks with counts in the reason', () => {
  const { home, repo } = setup();
  bigChange(repo);
  const r = check(repo, home);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^sprint-recap: 2 files \(\+30 -0\) changed this turn and no recap card has been rendered\. Invoke the sprint-recap skill/);
});

test('rule 5 outside git: counts files by mtime and omits line counts', () => {
  const home = makeHome();
  const dir = tmpDir();
  stamp(dir, home);
  write(dir, 'notes/a.md', 'x');
  write(dir, 'notes/b.md', 'x');
  const r = check(dir, home);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^sprint-recap: 2 files changed this turn/);
});

test('user config thresholds are respected', () => {
  const { home, repo } = setup();
  write(home, 'config.json', JSON.stringify({ minFiles: 5, minLines: 500 }));
  bigChange(repo);
  const r = check(repo, home);
  assert.equal(r.stdout, '');
});

test('fail-open: corrupt state file allows and logs', () => {
  const { home, repo } = setup();
  process.env.SPRINT_RECAP_HOME = home;
  fs.writeFileSync(state.statePath(state.resolveCwd(repo).key), '{ broken');
  bigChange(repo);
  const r = check(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8'), /check-recap/);
});

test('fail-open: missing git binary allows and logs', () => {
  const { home, repo } = setup();
  bigChange(repo);
  const emptyPath = tmpDir();
  const r = check(repo, home, {}, { PATH: emptyPath });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8'), /check-recap/);
});
