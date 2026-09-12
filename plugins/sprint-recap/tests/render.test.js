'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, makeHome, write, run } = require('./helpers');
const state = require('../scripts/lib/state');
const g = require('../scripts/lib/git');
const { width } = require('../scripts/lib/text');

const FIX = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const render = (input, opts = {}) => run('render.js', { input, args: ['--no-git', '--dry-run'], env: { SPRINT_RECAP_HOME: makeHome() }, ...opts });

test('renders the example fixture as a 70-column card', () => {
  const r = render(fixture('example.json'));
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trimEnd().split('\n');
  assert.ok(rows.length <= 30);
  for (const row of rows) assert.equal(width(row), 70, row);
  assert.ok(rows[0].startsWith('╭─ Sprint recap · Artefacts registry v1'));
  assert.ok(r.stdout.includes('CHECK'));
  assert.ok(!r.stdout.includes('the router, from the agent payload'), 'model answers must never be printed');
});

test('validation failure exits 1 with a one-line message naming the field', () => {
  const bad = { ...JSON.parse(fixture('example.json')), title: 'x'.repeat(29) };
  const r = render(JSON.stringify(bad));
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /^sprint-recap: title: /);
});

test('invalid JSON on stdin exits 1', () => {
  const r = render('{ nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^sprint-recap: stdin: /);
});

test('wrong question count is reported against questions', () => {
  const bad = { ...JSON.parse(fixture('example.json')), questions: [{ q: 'a?', a: 'b' }] };
  const r = render(JSON.stringify(bad));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^sprint-recap: questions: must have exactly 2/);
});

test('user config changes the required question count', () => {
  const home = makeHome();
  write(home, 'config.json', JSON.stringify({ questions: 3 }));
  const r = render(fixture('example.json'), { env: { SPRINT_RECAP_HOME: home } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /questions: must have exactly 3/);
});

test('wide characters are replaced with ? and rows stay 70 wide', () => {
  const r = render(fixture('wide.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('?? wide ?'));
  assert.ok(r.stdout.includes('café  over  naïve'));
  for (const row of r.stdout.trimEnd().split('\n')) assert.equal(width(row), 70, row);
});

test('unknown flag exits 1', () => {
  const r = render(fixture('minimal.json'), { args: ['--bogus'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag --bogus/);
});

test('a corrupt user config is reported against config.json', () => {
  const home = makeHome();
  write(home, 'config.json', '{ nope');
  const r = render(fixture('minimal.json'), { env: { SPRINT_RECAP_HOME: home } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^sprint-recap: config\.json: /);
});

test('at the home directory the card has no CHANGED section', () => {
  const home = makeHome();
  const fakeHome = initRepo();
  write(fakeHome, 'README.md', 'hello\nchanged\n');
  const r = run('render.js', {
    input: fixture('minimal.json'),
    args: ['--cwd', fakeHome],
    env: { SPRINT_RECAP_HOME: home, HOME: fakeHome },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('CHANGED'));
});

test('--dry-run leaves state and history untouched', () => {
  const home = makeHome();
  const repo = initRepo();
  const { key } = state.resolveCwd(repo);
  const before = state.freshState({ root: repo, git: true, head: g.head(repo), baseline: {}, now: new Date('2026-09-12T08:00:00Z') });
  before.turn = { started_at: '2026-09-12T08:30:00.000Z', head: g.head(repo), baseline: {}, recap_rendered_at: null };
  process.env.SPRINT_RECAP_HOME = home;
  state.writeState(key, before);
  const raw = fs.readFileSync(state.statePath(key), 'utf8');
  write(repo, 'src/a.ts', 'one\ntwo\n');
  const r = run('render.js', { input: fixture('minimal.json'), args: ['--dry-run', '--cwd', repo], env: { SPRINT_RECAP_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('CHANGED'));
  assert.ok(r.stdout.includes('src '));
  assert.equal(fs.readFileSync(state.statePath(key), 'utf8'), raw);
  assert.equal(fs.existsSync(path.join(home, 'history')), false);
});

test('a real run stamps the turn, resets the sprint and writes history', () => {
  const home = makeHome();
  const repo = initRepo();
  const { key } = state.resolveCwd(repo);
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.freshState({ root: repo, git: true, head: g.head(repo), baseline: {}, now: new Date('2026-09-12T08:00:00Z') });
  st.turn = { started_at: '2026-09-12T08:30:00.000Z', head: g.head(repo), baseline: {}, recap_rendered_at: null };
  state.writeState(key, st);
  write(repo, 'src/a.ts', 'one\ntwo\n');
  const r = run('render.js', { input: fixture('minimal.json'), args: ['--cwd', repo], env: { SPRINT_RECAP_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const after = state.readState(key);
  assert.ok(after.turn.recap_rendered_at);
  assert.notEqual(after.sprint.started_at, '2026-09-12T08:00:00.000Z');
  assert.deepEqual(after.sprint.baseline['src/a.ts'], [2, 0]);
  const files = fs.readdirSync(path.join(home, 'history'));
  assert.equal(files.length, 1);
  const entry = JSON.parse(fs.readFileSync(path.join(home, 'history', files[0]), 'utf8'));
  assert.equal(entry.recap.title, 'Tiny');
  assert.equal(entry.changes.files, 1);
  assert.equal(entry.card, r.stdout.trimEnd());
});

test('with no state file the whole working tree versus HEAD is shown and state is created', () => {
  const home = makeHome();
  const repo = initRepo();
  write(repo, 'README.md', 'hello\nchanged\n');
  const r = run('render.js', { input: fixture('minimal.json'), args: ['--cwd', repo], env: { SPRINT_RECAP_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0m · 1 file ─╮/);
  assert.ok(r.stdout.includes('README.md'));
  process.env.SPRINT_RECAP_HOME = home;
  assert.ok(state.readState(state.resolveCwd(repo).key));
});
