# Sprint Recap Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code plugin that replaces end-of-work prose with a deterministic 70x30 box-drawn recap card plus two comprehension questions, enforced by a Stop hook.

**Architecture:** Claude writes recap JSON; a zero-dependency Node script validates it, measures the change from git, lays out a fixed-width card with a pure layout module, prints it, and records state under `~/.claude/sprint-recap/`. Two hook scripts (UserPromptSubmit and Stop) share the same git/measure/state libraries so change detection is identical everywhere. All state is keyed by working directory, never by session.

**Tech Stack:** Node 25 (CommonJS, `node:test`, `node:assert`), git CLI, Claude Code plugin format (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/*/SKILL.md`), local marketplace.

**Spec:** `docs/superpowers/specs/2026-09-12-sprint-recap-design.md`

## Global Constraints

- Zero npm dependencies. Scripts are plain CommonJS run with `node`. Tests use `node --test`.
- Card is exactly 70 columns wide including borders and at most 30 rows including borders. Every row is exactly 70 code points.
- Geometry: 2 border + 2 left margin + 12 label gutter + 52 body + 2 right margin = 70. Content (gutter + body) is 64.
- Field limits (renderer exits 1 with one stderr line if violated): `title` 1–28; `components` 0–6, `label` 1–22, `id` unique; `edges` pairs of known ids; `decisions` 0–5, `chose`/`over` 1–20, `why` 0–50; `verification` 0–5, `check` 1–28, `result` ∈ pass|fail|skipped|unverified, `detail` 0–20; `questions` exactly configured count (default 2), `q` 1–98, `a` 1–200.
- Glyphs: `╭ ╮ ╰ ╯ │ ─`, bar `█`, bullet `●`, verification `✓ ✗ ○ ?`, arrow `→`, separator `·`, cut `…`.
- Nothing is ever written inside a project repo. All state lives under `~/.claude/sprint-recap/` (`config.json`, `sessions/<cwd-hash>.json`, `history/*.json`, `hook-errors.log`).
- `cwd-hash` is the first 12 hex chars of SHA-1 of the real path of the git top level, or of the cwd outside git.
- Hooks fail open: any thrown error is appended to `hook-errors.log` and the hook exits 0 with no output.
- Hooks print nothing on the allow path.
- Default config: `{ "minFiles": 2, "minLines": 20, "width": 70, "maxRows": 30, "questions": 2 }`.
- Trim order when the card is too tall: (1) collapse changed groups beyond top 3 into `+<n> more`, (2) drop `why` rows, (3) cap decisions at 3 plus `+<n> more` row, (4) cap changed groups at 2, (5) collapse flow to `<n> components, <m> edges`. Verification and questions are never trimmed.
- Commit messages follow the repo's existing style: imperative sentence, no prefix, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning

- **Test runner invocation.** Node 25 treats `node --test <dir>` as a single test file and fails. The plan uses `node --test "plugins/sprint-recap/tests/*.test.js"` (quoted glob, expanded by Node). The README documents this form.
- **Allowed characters.** The spec's strict "East Asian Width Neutral/Narrow/Half-width only" rule would turn `é`, `ø`, `ü` into `?` because those are classed Ambiguous. The sanitizer instead allows printable ASCII plus U+00A1–U+00AC and U+00AE–U+024F (Latin-1 symbols and letters, Latin Extended-A/B), after NFC normalisation, and replaces everything else with `?`. Soft hyphen U+00AD is excluded because it is zero-width. Every allowed code point renders as one column in every terminal Emil uses.
- **Extra lib files.** `lib/text.js` (sanitize, fit, wrap), `lib/validate.js` (recap validation), and `lib/measure.js` (mtime scan + shared change measurement) are added beside the four lib files the spec lists so each file has one responsibility.
- **State dir override for tests.** `SPRINT_RECAP_HOME` env var overrides `~/.claude/sprint-recap` so tests never touch real state. Documented in the README.
- **Empty repositories.** When HEAD does not exist (fresh `git init`), diffs are taken against git's well-known empty tree object so staged and committed files still count. The spec's "baseline lost" case only fires when a previously recorded head has disappeared.
- **Flow wrap width.** The spec says flow rows wrap past 64 columns; every other section uses the 52-column body. Flow wraps at 52 so the gutter stays aligned.

## File Structure

```
~/Claude/claude-plugins/
  .claude-plugin/marketplace.json          marketplace "emil-plugins"
  package.json                             test script only
  README.md                                repo overview + install
  plugins/sprint-recap/
    .claude-plugin/plugin.json
    README.md                              install, config, state, smoke test
    hooks/hooks.json
    skills/sprint-recap/SKILL.md
    scripts/
      defaults.json
      render.js                            CLI: JSON in, card out, state/history update
      stamp-turn.js                        UserPromptSubmit hook
      check-recap.js                       Stop hook
      lib/
        config.js                          baseDir(), loadConfig()
        text.js                            sanitize, width, fit, padStart, wrapWords
        validate.js                        validateRecap, ValidationError
        layout.js                          layoutCard (pure), LayoutError, flowRows
        git.js                             topLevel, head, refExists, numstat, untracked, snapshot, delta, groupName, groupChanges
        measure.js                         scanMtime, measure
        state.js                           resolveCwd, readState, writeState, freshState, newSprint, isHomeOrRoot, writeHistory, logHookError
    tests/
      helpers.js
      config.test.js
      text.test.js
      validate.test.js
      layout.test.js
      git.test.js
      measure.test.js
      state.test.js
      render.test.js
      stamp-turn.test.js
      check-recap.test.js
      fixtures/
        minimal.json
        example.json
        max.json
        wide.json
```

All commands below run from `~/Claude/claude-plugins` unless stated. Test command for the whole suite:

```bash
node --test "plugins/sprint-recap/tests/*.test.js"
```

---

### Task 1: Repository scaffold and plugin manifests

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `package.json`
- Create: `plugins/sprint-recap/.claude-plugin/plugin.json`
- Create: `plugins/sprint-recap/scripts/defaults.json`
- Create: `plugins/sprint-recap/tests/helpers.js`

**Interfaces:**
- Produces: `defaults.json` keys `minFiles, minLines, width, maxRows, questions` consumed by Task 2.
- Produces: `tests/helpers.js` exports `tmpDir()`, `makeHome()`, `initRepo()`, `git(cwd, args)`, `write(dir, rel, content)`, `run(script, opts)`, `SCRIPTS` (absolute path to `scripts/`), used by every later test.

- [ ] **Step 1: Create the marketplace manifest**

```json
{
  "name": "emil-plugins",
  "description": "Emil's local Claude Code plugins",
  "owner": { "name": "Emil Fabel" },
  "plugins": [
    {
      "name": "sprint-recap",
      "description": "One-screen visual sprint recap card with comprehension questions, enforced by a Stop hook",
      "source": "./plugins/sprint-recap",
      "version": "0.1.0",
      "category": "productivity",
      "tags": ["recap", "summary", "hooks"]
    }
  ]
}
```

Save as `.claude-plugin/marketplace.json`.

- [ ] **Step 2: Create the plugin manifest**

```json
{
  "name": "sprint-recap",
  "version": "0.1.0",
  "description": "One-screen visual sprint recap card with comprehension questions, enforced by a Stop hook",
  "author": { "name": "Emil Fabel" },
  "keywords": ["recap", "summary", "hooks", "terminal"]
}
```

Save as `plugins/sprint-recap/.claude-plugin/plugin.json`.

- [ ] **Step 3: Create defaults.json**

```json
{
  "minFiles": 2,
  "minLines": 20,
  "width": 70,
  "maxRows": 30,
  "questions": 2
}
```

Save as `plugins/sprint-recap/scripts/defaults.json`.

- [ ] **Step 4: Create package.json at the repo root**

```json
{
  "name": "emil-plugins",
  "private": true,
  "description": "Local Claude Code plugin marketplace",
  "scripts": {
    "test": "node --test \"plugins/sprint-recap/tests/*.test.js\""
  }
}
```

- [ ] **Step 5: Create the shared test helpers**

`plugins/sprint-recap/tests/helpers.js`:

```js
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

// Real path matters: macOS puts tmp under /var which is a symlink to /private/var.
function tmpDir(prefix = 'sprint-recap-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A fresh, isolated SPRINT_RECAP_HOME.
function makeHome() {
  return tmpDir('sprint-recap-home-');
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// Temp git repo with one commit containing README.md.
function initRepo() {
  const dir = tmpDir('sprint-recap-repo-');
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, 'README.md', 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

// Run one of the plugin scripts as a child process.
function run(script, { input = '', cwd = process.cwd(), env = {}, args = [] } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    input,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

module.exports = { SCRIPTS, tmpDir, makeHome, git, write, initRepo, run };
```

- [ ] **Step 6: Validate the manifests with the Claude CLI**

Run:
```bash
claude plugin validate . && claude plugin validate plugins/sprint-recap
```
Expected: both report the manifest as valid (exit 0). If `validate` warns about a missing `hooks` or `skills` directory, that is expected until Task 12.

- [ ] **Step 7: Commit**

```bash
git add .claude-plugin package.json plugins/sprint-recap/.claude-plugin plugins/sprint-recap/scripts/defaults.json plugins/sprint-recap/tests/helpers.js
git commit -m "$(cat <<'EOF'
Scaffold emil-plugins marketplace and sprint-recap plugin manifests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Config loader

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/config.js`
- Test: `plugins/sprint-recap/tests/config.test.js`

**Interfaces:**
- Produces: `baseDir()` → string. `process.env.SPRINT_RECAP_HOME` if set, else `~/.claude/sprint-recap`.
- Produces: `loadConfig()` → `{ minFiles, minLines, width, maxRows, questions }` = defaults.json shallow-merged with `<baseDir>/config.json` if present. Throws if the user file is not valid JSON.
- Produces: `DEFAULTS_PATH` → absolute path of `defaults.json`.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/config.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome, write } = require('./helpers');
const { baseDir, loadConfig } = require('../scripts/lib/config');

test('baseDir honours SPRINT_RECAP_HOME', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  assert.equal(baseDir(), home);
  delete process.env.SPRINT_RECAP_HOME;
  assert.ok(baseDir().endsWith(path.join('.claude', 'sprint-recap')));
});

test('loadConfig returns shipped defaults when no user file exists', () => {
  process.env.SPRINT_RECAP_HOME = makeHome();
  assert.deepEqual(loadConfig(), { minFiles: 2, minLines: 20, width: 70, maxRows: 30, questions: 2 });
});

test('loadConfig merges user overrides over defaults', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  write(home, 'config.json', JSON.stringify({ minLines: 5, questions: 3 }));
  const c = loadConfig();
  assert.equal(c.minLines, 5);
  assert.equal(c.questions, 3);
  assert.equal(c.minFiles, 2);
});

test('loadConfig throws on a corrupt user file', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  write(home, 'config.json', '{ not json');
  assert.throws(() => loadConfig(), SyntaxError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/config.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/config'`.

- [ ] **Step 3: Implement config.js**

`plugins/sprint-recap/scripts/lib/config.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/config.test.js`
Expected: `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/config.js plugins/sprint-recap/tests/config.test.js
git commit -m "$(cat <<'EOF'
Add config loader with SPRINT_RECAP_HOME override

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Text primitives

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/text.js`
- Test: `plugins/sprint-recap/tests/text.test.js`

**Interfaces:**
- Produces: `sanitize(str)` → string. NFC-normalises, then replaces every code point outside `[\x20-\x7E¡-¬®-ɏ]` with `?`.
- Produces: `width(str)` → number of code points (all allowed code points are one column wide).
- Produces: `fit(str, n)` → exactly `n` code points: right-padded with spaces, or cut to `n-1` plus `…`.
- Produces: `padStart(str, n)` → left-padded to at least `n`.
- Produces: `wrapWords(str, n, maxLines)` → string[] of 1..maxLines lines each ≤ `n`; words longer than `n` are broken; overflow past `maxLines` is cut with `…`.
- Produces: `ELLIPSIS` = `'…'`.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/text.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, width, fit, padStart, wrapWords } = require('../scripts/lib/text');

test('sanitize keeps ASCII and Latin letters, replaces wide and emoji with ?', () => {
  assert.equal(sanitize('héllo øre café'), 'héllo øre café');
  assert.equal(sanitize('日本 x'), '?? x');
  assert.equal(sanitize('go 🚀'), 'go ?');
  assert.equal(sanitize('tab\there'), 'tab?here');
  assert.equal(sanitize('soft­hyphen'), 'soft?hyphen');
});

test('sanitize normalises decomposed accents before checking', () => {
  assert.equal(sanitize('é'), 'é');
});

test('width counts code points', () => {
  assert.equal(width('╭─●…'), 4);
  assert.equal(width(''), 0);
});

test('fit pads short strings and cuts long ones with an ellipsis', () => {
  assert.equal(fit('abc', 5), 'abc  ');
  assert.equal(fit('abcdef', 5), 'abcd…');
  assert.equal(fit('abcde', 5), 'abcde');
  assert.equal(fit('', 2), '  ');
});

test('padStart right-aligns', () => {
  assert.equal(padStart('+12', 6), '   +12');
  assert.equal(padStart('+1234567', 6), '+1234567');
});

test('wrapWords wraps at word boundaries within the limit', () => {
  assert.deepEqual(wrapWords('the quick brown fox jumps', 10, 3), ['the quick', 'brown fox', 'jumps']);
});

test('wrapWords breaks words longer than the width', () => {
  assert.deepEqual(wrapWords('abcdefghijkl end', 5, 4), ['abcde', 'fghij', 'kl', 'end']);
});

test('wrapWords cuts overflow past maxLines with an ellipsis', () => {
  const lines = wrapWords('one two three four five six', 9, 2);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'one two');
  assert.ok(lines[1].endsWith('…'));
  assert.ok(width(lines[1]) <= 9);
});

test('wrapWords returns one empty line for empty input', () => {
  assert.deepEqual(wrapWords('', 10, 2), ['']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/text.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/text'`.

- [ ] **Step 3: Implement text.js**

`plugins/sprint-recap/scripts/lib/text.js`:

```js
'use strict';

// Every allowed code point renders in exactly one terminal column:
// printable ASCII, Latin-1 symbols and letters, Latin Extended-A/B.
// Soft hyphen U+00AD is zero-width and therefore excluded.
const ALLOWED = /[\x20-\x7E¡-¬®-ɏ]/u;
const ELLIPSIS = '…';

function sanitize(str) {
  return [...String(str).normalize('NFC')].map((c) => (ALLOWED.test(c) ? c : '?')).join('');
}

function width(str) {
  return [...str].length;
}

// Exactly n code points: pad with spaces or cut to n-1 plus an ellipsis.
function fit(str, n) {
  const chars = [...str];
  if (chars.length <= n) return str + ' '.repeat(n - chars.length);
  if (n <= 1) return ELLIPSIS.repeat(n);
  return chars.slice(0, n - 1).join('') + ELLIPSIS;
}

function padStart(str, n) {
  const w = width(str);
  return w >= n ? str : ' '.repeat(n - w) + str;
}

// Word-wrap into at most maxLines lines of at most n code points.
function wrapWords(str, n, maxLines) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (width(word) > n) {
      if (line) { lines.push(line); line = ''; }
      const chars = [...word];
      lines.push(chars.slice(0, n).join(''));
      word = chars.slice(n).join('');
    }
    if (!word) continue;
    if (!line) line = word;
    else if (width(line) + 1 + width(word) <= n) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length === 0) lines.push('');
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    return [...lines.slice(0, maxLines - 1), fit(rest, n).trimEnd()];
  }
  return lines;
}

module.exports = { sanitize, width, fit, padStart, wrapWords, ELLIPSIS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/text.test.js`
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/text.js plugins/sprint-recap/tests/text.test.js
git commit -m "$(cat <<'EOF'
Add text primitives: sanitize, fit, wrap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Recap validation

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/validate.js`
- Test: `plugins/sprint-recap/tests/validate.test.js`
- Create: `plugins/sprint-recap/tests/fixtures/example.json`

**Interfaces:**
- Consumes: `sanitize`, `width` from `lib/text.js`.
- Produces: `validateRecap(input, { questions = 2 })` → normalised recap `{ title, components: [{id,label}], edges: [[from,to]], decisions: [{chose,over,why}], verification: [{check,result,detail}], questions: [{q,a}] }`. Optional sections default to `[]`; optional strings default to `''`. All strings are sanitized and trimmed.
- Produces: `class ValidationError extends Error` with `.field` (e.g. `decisions[1].why`) and message `"<field>: <problem>"`.
- Produces: `RESULTS = ['pass','fail','skipped','unverified']`.

- [ ] **Step 1: Create the example fixture (the spec's section 7 example)**

`plugins/sprint-recap/tests/fixtures/example.json`:

```json
{
  "title": "Artefacts registry v1",
  "components": [
    { "id": "ui",  "label": "/artifacts page" },
    { "id": "api", "label": "artefact router" },
    { "id": "db",  "label": "Artefact model" }
  ],
  "edges": [["ui", "api"], ["api", "db"]],
  "decisions": [
    { "chose": "polymorphic table", "over": "one table per type", "why": "single list query" }
  ],
  "verification": [
    { "check": "vitest artefacts", "result": "pass", "detail": "14/14" },
    { "check": "manual click-through", "result": "skipped" }
  ],
  "questions": [
    { "q": "Which layer decides an artefact's type?", "a": "the router, from the agent payload" },
    { "q": "Why one table instead of one per type?", "a": "single list query for the registry" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`plugins/sprint-recap/tests/validate.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecap, ValidationError } = require('../scripts/lib/validate');

const example = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'example.json'), 'utf8'));

function fieldOf(fn) {
  try { fn(); } catch (e) { assert.ok(e instanceof ValidationError, `expected ValidationError, got ${e}`); return e.field; }
  assert.fail('expected a ValidationError');
}

test('accepts the spec example and normalises optional fields', () => {
  const r = validateRecap(example());
  assert.equal(r.title, 'Artefacts registry v1');
  assert.equal(r.components.length, 3);
  assert.deepEqual(r.edges, [['ui', 'api'], ['api', 'db']]);
  assert.equal(r.verification[1].detail, '');
  assert.equal(r.decisions[0].why, 'single list query');
});

test('minimal recap needs only title and questions', () => {
  const r = validateRecap({ title: 'x', questions: [{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }] });
  assert.deepEqual(r.components, []);
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.decisions, []);
  assert.deepEqual(r.verification, []);
});

test('title length limits', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), title: '' })), 'title');
  assert.equal(fieldOf(() => validateRecap({ ...example(), title: 'x'.repeat(29) })), 'title');
  assert.equal(validateRecap({ ...example(), title: 'x'.repeat(28) }).title.length, 28);
});

test('component limits and duplicate ids', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, label: 'l' }));
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: seven, edges: [] })), 'components');
  const dup = [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }];
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: dup, edges: [] })), 'components[1].id');
  const long = [{ id: 'a', label: 'x'.repeat(23) }];
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: long, edges: [] })), 'components[0].label');
});

test('edges must reference known ids and be pairs', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), edges: [['ui', 'nope']] })), 'edges[0]');
  assert.equal(fieldOf(() => validateRecap({ ...example(), edges: [['ui']] })), 'edges[0]');
});

test('decision limits', () => {
  const six = Array.from({ length: 6 }, () => ({ chose: 'a', over: 'b' }));
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: six })), 'decisions');
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: [{ chose: 'x'.repeat(21), over: 'b' }] })), 'decisions[0].chose');
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: [{ chose: 'a', over: 'b', why: 'x'.repeat(51) }] })), 'decisions[0].why');
});

test('verification limits and result enum', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'a', result: 'ok' }] })), 'verification[0].result');
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'x'.repeat(29), result: 'pass' }] })), 'verification[0].check');
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'a', result: 'pass', detail: 'x'.repeat(21) }] })), 'verification[0].detail');
});

test('questions must match the configured count', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), questions: [{ q: 'a?', a: 'b' }] })), 'questions');
  const three = [{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }, { q: 'e?', a: 'f' }];
  assert.equal(validateRecap({ ...example(), questions: three }, { questions: 3 }).questions.length, 3);
  assert.equal(fieldOf(() => validateRecap({ ...example(), questions: [{ q: 'x'.repeat(99), a: 'b' }, { q: 'c?', a: 'd' }] })), 'questions[0].q');
});

test('strings are sanitized so wide characters become ?', () => {
  const r = validateRecap({ ...example(), title: '日本 test' });
  assert.equal(r.title, '?? test');
});

test('non-object input is rejected', () => {
  assert.equal(fieldOf(() => validateRecap([])), 'recap');
  assert.equal(fieldOf(() => validateRecap(null)), 'recap');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/validate.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/validate'`.

- [ ] **Step 4: Implement validate.js**

`plugins/sprint-recap/scripts/lib/validate.js`:

```js
'use strict';
const { sanitize, width } = require('./text');

const RESULTS = ['pass', 'fail', 'skipped', 'unverified'];

class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

function str(value, field, min, max) {
  if (typeof value !== 'string') throw new ValidationError(field, 'must be a string');
  const clean = sanitize(value).trim();
  const w = width(clean);
  if (w < min || w > max) throw new ValidationError(field, `must be ${min} to ${max} characters, got ${w}`);
  return clean;
}

function optStr(value, field, max) {
  return value === undefined || value === null ? '' : str(value, field, 0, max);
}

function list(value, field, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, 'must be an array');
  if (value.length > max) throw new ValidationError(field, `at most ${max} entries, got ${value.length}`);
  return value;
}

function obj(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(field, 'must be an object');
  return value;
}

function validateRecap(input, { questions = 2 } = {}) {
  obj(input, 'recap');
  const out = {};
  out.title = str(input.title, 'title', 1, 28);

  const ids = new Set();
  out.components = list(input.components, 'components', 6).map((c, i) => {
    const f = `components[${i}]`;
    obj(c, f);
    const id = str(c.id, `${f}.id`, 1, 40);
    if (ids.has(id)) throw new ValidationError(`${f}.id`, `duplicate id "${id}"`);
    ids.add(id);
    return { id, label: str(c.label, `${f}.label`, 1, 22) };
  });

  out.edges = list(input.edges, 'edges', 30).map((e, i) => {
    const f = `edges[${i}]`;
    if (!Array.isArray(e) || e.length !== 2) throw new ValidationError(f, 'must be a pair [from, to]');
    const pair = e.map((id) => (typeof id === 'string' ? sanitize(id).trim() : ''));
    for (const id of pair) if (!ids.has(id)) throw new ValidationError(f, `unknown component id "${id}"`);
    return pair;
  });

  out.decisions = list(input.decisions, 'decisions', 5).map((d, i) => {
    const f = `decisions[${i}]`;
    obj(d, f);
    return {
      chose: str(d.chose, `${f}.chose`, 1, 20),
      over: str(d.over, `${f}.over`, 1, 20),
      why: optStr(d.why, `${f}.why`, 50),
    };
  });

  out.verification = list(input.verification, 'verification', 5).map((v, i) => {
    const f = `verification[${i}]`;
    obj(v, f);
    if (!RESULTS.includes(v.result)) throw new ValidationError(`${f}.result`, `must be one of ${RESULTS.join(', ')}`);
    return {
      check: str(v.check, `${f}.check`, 1, 28),
      result: v.result,
      detail: optStr(v.detail, `${f}.detail`, 20),
    };
  });

  if (!Array.isArray(input.questions) || input.questions.length !== questions) {
    throw new ValidationError('questions', `must have exactly ${questions} entries`);
  }
  out.questions = input.questions.map((q, i) => {
    const f = `questions[${i}]`;
    obj(q, f);
    return { q: str(q.q, `${f}.q`, 1, 98), a: str(q.a, `${f}.a`, 1, 200) };
  });

  return out;
}

module.exports = { validateRecap, ValidationError, RESULTS };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/validate.test.js`
Expected: `ℹ pass 10`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/validate.js plugins/sprint-recap/tests/validate.test.js plugins/sprint-recap/tests/fixtures/example.json
git commit -m "$(cat <<'EOF'
Add recap JSON validation with per-field limits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Card layout (pure)

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/layout.js`
- Create: `plugins/sprint-recap/tests/fixtures/minimal.json`
- Create: `plugins/sprint-recap/tests/fixtures/max.json`
- Create: `plugins/sprint-recap/tests/fixtures/wide.json`
- Test: `plugins/sprint-recap/tests/layout.test.js`

**Interfaces:**
- Consumes: `fit`, `width`, `padStart`, `wrapWords` from `lib/text.js`; validated recap shape from Task 4.
- Consumes (shape only, produced in Task 7): `changes = { git: boolean, groups: [{ name, files, added, removed }] }` sorted by `added+removed` descending. `null` means no CHANGED section.
- Produces: `layoutCard({ recap, changes = null, meta: { elapsed, files }, width = 70, maxRows = 30 })` → `string[]` of rows, each exactly `width` code points, length ≤ `maxRows`. Throws `LayoutError` if it cannot fit after all five trim steps or if `width < 70`.
- Produces: `flowRows(components, edges, collapse, bodyWidth)` → `string[]` (exported for tests).
- Produces: `class LayoutError extends Error`.

- [ ] **Step 1: Create the remaining fixtures**

`plugins/sprint-recap/tests/fixtures/minimal.json`:

```json
{
  "title": "Tiny",
  "questions": [
    { "q": "Why?", "a": "Because." },
    { "q": "How?", "a": "Like so." }
  ]
}
```

`plugins/sprint-recap/tests/fixtures/max.json` (every field at its section 7 maximum; string lengths are verified: title 28, labels 22, chose/over 20, why 50, check 28, detail 20, q 98):

```json
{
  "title": "Artefacts registry v1 final!",
  "components": [
    { "id": "c1", "label": "artefacts list page UI" },
    { "id": "c2", "label": "artefact router module" },
    { "id": "c3", "label": "artefact prisma model!" },
    { "id": "c4", "label": "session resume service" },
    { "id": "c5", "label": "agent payload adapters" },
    { "id": "c6", "label": "typed deliverable view" }
  ],
  "edges": [["c1", "c2"], ["c2", "c3"], ["c3", "c4"], ["c4", "c5"], ["c5", "c6"]],
  "decisions": [
    { "chose": "polymorphic table !!", "over": "one table per type !", "why": "single list query keeps the registry page simple!!" },
    { "chose": "polymorphic table !!", "over": "one table per type !", "why": "single list query keeps the registry page simple!!" },
    { "chose": "polymorphic table !!", "over": "one table per type !", "why": "single list query keeps the registry page simple!!" },
    { "chose": "polymorphic table !!", "over": "one table per type !", "why": "single list query keeps the registry page simple!!" },
    { "chose": "polymorphic table !!", "over": "one table per type !", "why": "single list query keeps the registry page simple!!" }
  ],
  "verification": [
    { "check": "vitest artefacts full suite!", "result": "pass", "detail": "14/14 passed locally" },
    { "check": "vitest artefacts full suite!", "result": "fail", "detail": "14/14 passed locally" },
    { "check": "vitest artefacts full suite!", "result": "skipped", "detail": "14/14 passed locally" },
    { "check": "vitest artefacts full suite!", "result": "unverified", "detail": "14/14 passed locally" },
    { "check": "vitest artefacts full suite!", "result": "pass", "detail": "14/14 passed locally" }
  ],
  "questions": [
    { "q": "Why does the router own artefact type detection instead of the Prisma model or the page component?", "a": "The router sees the agent payload first and the model must stay storage-only." },
    { "q": "Why did we keep one polymorphic table instead of one table per artefact type, given the tradeoffs?", "a": "One list query for the registry page; per-type tables would need a union." }
  ]
}
```

`plugins/sprint-recap/tests/fixtures/wide.json`:

```json
{
  "title": "日本 wide 🚀",
  "decisions": [{ "chose": "café", "over": "naïve", "why": "日本語" }],
  "questions": [
    { "q": "Why?", "a": "Because." },
    { "q": "How?", "a": "Like so." }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`plugins/sprint-recap/tests/layout.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecap } = require('../scripts/lib/validate');
const { layoutCard, flowRows, LayoutError } = require('../scripts/lib/layout');
const { width } = require('../scripts/lib/text');

const FIX = path.join(__dirname, 'fixtures');
const load = (name) => validateRecap(JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')));
const meta = { elapsed: '12m', files: 4 };

function groups(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `src/dir${i}`, files: 2, added: 100 - i * 10, removed: i }));
}
const eightGroups = { git: true, groups: groups(8) };

function bodies(rows, label) {
  // Body text of the rows belonging to one section, identified by its gutter label.
  const start = rows.findIndex((r) => r.startsWith("│") && r.slice(3, 15).trim() === label);
  if (start < 0) return [];
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (i > start && (r.trim() === '│' + ' '.repeat(68) + '│' || r.startsWith('╰'))) break;
    if (i > start && r.slice(3, 15).trim() !== '' && r.slice(3, 15).trim() !== 'YOURSELF') break;
    out.push(r.slice(15, 67).trimEnd());
  }
  return out;
}

test('every fixture renders rows of exactly 70 code points and at most 30 rows', () => {
  for (const file of fs.readdirSync(FIX)) {
    const rows = layoutCard({ recap: load(file), changes: eightGroups, meta });
    assert.ok(rows.length <= 30, `${file}: ${rows.length} rows`);
    for (const r of rows) assert.equal(width(r), 70, `${file}: "${r}"`);
  }
});

test('header carries title, elapsed and file count; footer closes the box', () => {
  const rows = layoutCard({ recap: load('example.json'), changes: null, meta });
  assert.ok(rows[0].startsWith('╭─ Sprint recap · Artefacts registry v1 ─'));
  assert.ok(rows[0].endsWith(' 12m · 4 files ─╮'));
  assert.equal(rows.at(-1), '╰' + '─'.repeat(68) + '╯');
});

test('a long title is cut with an ellipsis when the header is crowded', () => {
  const recap = load('max.json');
  const rows = layoutCard({ recap, changes: null, meta: { elapsed: 'baseline lost', files: 12 } });
  assert.ok(rows[0].includes('…'));
  assert.equal(width(rows[0]), 70);
});

test('sections appear in order with one blank row before each and correct labels', () => {
  const rows = layoutCard({ recap: load('example.json'), changes: eightGroups, meta });
  const labels = rows.filter((r) => r.startsWith("│")).map((r) => r.slice(3, 15).trim()).filter(Boolean);
  assert.deepEqual(labels, ['CHANGED', 'FLOW', 'DECIDED', 'VERIFIED', 'CHECK', 'YOURSELF']);
  const blankIdx = rows.map((r, i) => (r === '│' + ' '.repeat(68) + '│' ? i : -1)).filter((i) => i >= 0);
  assert.equal(blankIdx.length, 5);
});

test('empty sections are omitted', () => {
  const rows = layoutCard({ recap: load('minimal.json'), changes: null, meta });
  const labels = rows.filter((r) => r.startsWith("│")).map((r) => r.slice(3, 15).trim()).filter(Boolean);
  assert.deepEqual(labels, ['CHECK', 'YOURSELF']);
});

test('CHANGED rows: path 18, bar 16 scaled to the largest, +added in 6, -removed in 5', () => {
  const changes = { git: true, groups: [
    { name: 'src/app', files: 3, added: 160, removed: 8 },
    { name: 'prisma', files: 1, added: 20, removed: 1 },
    { name: 'a-very-long-directory/name', files: 1, added: 1, removed: 0 },
  ] };
  const b = bodies(layoutCard({ recap: load('minimal.json'), changes, meta }), 'CHANGED');
  assert.equal(b[0], 'src/app            ' + '█'.repeat(16) + '   +160   -8');
  assert.equal(b[1], 'prisma             ' + '██' + ' '.repeat(14) + '    +20   -1');
  assert.ok(b[2].startsWith('a-very-long-direc…'));
  assert.equal(b[2].slice(19, 20), '█');
});

test('CHANGED outside git shows file counts instead of bars', () => {
  const changes = { git: false, groups: [{ name: 'notes', files: 3, added: 0, removed: 0 }, { name: 'todo.md', files: 1, added: 0, removed: 0 }] };
  const b = bodies(layoutCard({ recap: load('minimal.json'), changes, meta }), 'CHANGED');
  assert.equal(b[0], 'notes              3 files');
  assert.equal(b[1], 'todo.md            1 file');
});

test('DECIDED rows: bullet line then indented why', () => {
  const b = bodies(layoutCard({ recap: load('example.json'), changes: null, meta }), 'DECIDED');
  assert.deepEqual(b, ['● polymorphic table  over  one table per type', '  single list query']);
});

test('VERIFIED rows use the right glyph per result', () => {
  const recap = load('max.json');
  const b = bodies(layoutCard({ recap, changes: null, meta }), 'VERIFIED');
  assert.deepEqual(b.map((r) => r[0]), ['✓', '✗', '○', '?', '✓']);
  assert.equal(b[0], '✓ vitest artefacts full suite!  14/14 passed locally');
});

test('CHECK YOURSELF numbers questions and wraps to at most two rows each', () => {
  const rows = layoutCard({ recap: load('max.json'), changes: null, meta });
  const b = bodies(rows, 'CHECK');
  assert.equal(b.length, 4);
  assert.ok(b[0].startsWith('1. '));
  assert.ok(b[1].startsWith('   '));
  assert.ok(b[2].startsWith('2. '));
  for (const r of b) assert.ok(width(r) <= 52);
});

test('flow: linear chain joins nodes with arrows', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['b', 'c']], false, 52), ['[A] → [B] → [C]']);
});

test('flow: disconnected nodes are listed after, comma separated', () => {
  const c = [{ id: 'x', label: 'X' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.deepEqual(flowRows(c, [['a', 'b']], false, 52), ['[A] → [B], [X]']);
});

test('flow: cycles are laid out in input order without looping', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['b', 'a']], false, 52), ['[A] → [B]']);
});

test('flow: branches show the first edge and list the rest', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['a', 'c']], false, 52), ['[A] → [B], [C]']);
});

test('flow: wraps past the body width onto indented continuation rows', () => {
  const recap = load('max.json');
  const rows = flowRows(recap.components, recap.edges, false, 52);
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.ok(width(r) <= 52, r);
  for (const r of rows.slice(1)) assert.ok(r.startsWith('  → ['), r);
});

test('flow: collapsed form', () => {
  const recap = load('max.json');
  assert.deepEqual(flowRows(recap.components, recap.edges, true, 52), ['6 components, 5 edges']);
});

test('trim steps apply in order as the row budget shrinks', () => {
  const recap = load('max.json');
  const args = (maxRows) => ({ recap, changes: eightGroups, meta, maxRows });

  const r0 = layoutCard(args(100));
  assert.equal(bodies(r0, 'CHANGED').length, 8);
  assert.equal(bodies(r0, 'DECIDED').length, 10);
  assert.ok(bodies(r0, 'FLOW').length >= 3);

  const r1 = layoutCard(args(r0.length - 1));                     // step 1
  assert.deepEqual(bodies(r1, 'CHANGED').slice(3), ['+5 more']);
  assert.equal(bodies(r1, 'DECIDED').length, 10);

  const r2 = layoutCard(args(r1.length - 1));                     // step 2
  assert.equal(bodies(r2, 'DECIDED').length, 5);
  assert.ok(bodies(r2, 'DECIDED').every((b) => b.startsWith('●')));
  assert.deepEqual(bodies(r2, 'CHANGED').slice(3), ['+5 more']);

  const r3 = layoutCard(args(r2.length - 1));                     // step 3
  assert.deepEqual(bodies(r3, 'DECIDED').slice(3), ['+2 more']);
  assert.equal(bodies(r3, 'DECIDED').length, 4);

  const r4 = layoutCard(args(r3.length - 1));                     // step 4
  assert.deepEqual(bodies(r4, 'CHANGED').slice(2), ['+6 more']);
  assert.ok(bodies(r4, 'FLOW').length >= 3);

  const r5 = layoutCard(args(r4.length - 1));                     // step 5
  assert.deepEqual(bodies(r5, 'FLOW'), ['6 components, 5 edges']);
  assert.equal(bodies(r5, 'VERIFIED').length, 5);
  assert.equal(bodies(r5, 'CHECK').length, 4);

  assert.throws(() => layoutCard(args(r5.length - 1)), LayoutError);
});

test('the maximum fixture with eight changed groups fits in 30 rows without throwing', () => {
  const rows = layoutCard({ recap: load('max.json'), changes: eightGroups, meta });
  assert.ok(rows.length <= 30);
});

test('width below 70 is rejected', () => {
  assert.throws(() => layoutCard({ recap: load('minimal.json'), changes: null, meta, width: 60 }), LayoutError);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/layout.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/layout'`.

- [ ] **Step 4: Implement layout.js**

`plugins/sprint-recap/scripts/lib/layout.js`:

```js
'use strict';
const { fit, width, padStart, wrapWords } = require('./text');

const MIN_WIDTH = 70;
const GUTTER = 12;
const MARGIN = 2;
const GLYPH = { pass: '✓', fail: '✗', skipped: '○', unverified: '?' };

class LayoutError extends Error {
  constructor(message) { super(message); this.name = 'LayoutError'; }
}

// W = total width including borders, B = body width after gutter and margins.
function geometry(w) {
  if (!Number.isInteger(w) || w < MIN_WIDTH) throw new LayoutError(`width must be an integer >= ${MIN_WIDTH}`);
  return { W: w, B: w - 2 - 2 * MARGIN - GUTTER };
}

function row(label, body, g) {
  if (width(body) > g.B) throw new LayoutError(`body wider than ${g.B}: "${body}"`);
  return '│' + ' '.repeat(MARGIN) + fit(label, GUTTER) + fit(body, g.B) + ' '.repeat(MARGIN) + '│';
}
const blank = (g) => '│' + ' '.repeat(g.W - 2) + '│';
const footer = (g) => '╰' + '─'.repeat(g.W - 2) + '╯';

function header(title, right, g) {
  const left = '╭─ Sprint recap · ';
  const tail = ` ${right} ─╮`;
  const avail = g.W - width(left) - 1 - width(tail);
  const t = width(title) > avail ? fit(title, avail) : title;
  const fill = g.W - width(left) - width(t) - 1 - width(tail);
  return left + t + ' ' + '─'.repeat(fill) + tail;
}

function section(label, bodyList, g, secondLabel = '') {
  return bodyList.map((b, i) => row(i === 0 ? label : i === 1 ? secondLabel : '', b, g));
}

// Numbers that would overflow their column collapse to thousands.
function num(n, w) {
  const s = String(n);
  return s.length <= w - 1 ? s : `${Math.floor(n / 1000)}k`;
}

function changedRows(changes, cap) {
  const all = changes.groups;
  const shown = all.slice(0, cap);
  const max = Math.max(1, ...shown.map((x) => x.added + x.removed));
  const out = shown.map((x) => {
    if (!changes.git) return `${fit(x.name, 18)} ${x.files} file${x.files === 1 ? '' : 's'}`;
    const bar = '█'.repeat(Math.max(1, Math.round(((x.added + x.removed) / max) * 16)));
    return `${fit(x.name, 18)} ${fit(bar, 16)} ${padStart('+' + num(x.added, 6), 6)}${padStart('-' + num(x.removed, 5), 5)}`;
  });
  if (all.length > shown.length) out.push(`+${all.length - shown.length} more`);
  return out;
}

// Chains of labels. Starts are nodes with no incoming edge that have an outgoing
// edge, in input order; then everything else in input order. Each chain follows
// the first edge to an unvisited node. Isolated nodes therefore come last.
function flowChains(components, edges) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out = new Map(components.map((c) => [c.id, []]));
  const indeg = new Map(components.map((c) => [c.id, 0]));
  for (const [a, b] of edges) { out.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
  const ids = components.map((c) => c.id);
  const starts = [...ids.filter((id) => indeg.get(id) === 0 && out.get(id).length > 0), ...ids];
  const visited = new Set();
  const chains = [];
  for (const start of starts) {
    if (visited.has(start)) continue;
    const chain = [];
    let cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      chain.push(byId.get(cur).label);
      cur = out.get(cur).find((n) => !visited.has(n));
    }
    chains.push(chain);
  }
  return chains;
}

function flowRows(components, edges, collapse, B) {
  if (collapse) return [`${components.length} components, ${edges.length} edges`];
  const rows = [];
  let line = '';
  const push = (sep, node) => {
    const candidate = line ? line + sep + node : node;
    if (line && width(candidate) > B) {
      rows.push(sep === ', ' ? line + ',' : line);
      line = (sep === ' → ' ? '  → ' : '  ') + node;
    } else {
      line = candidate;
    }
  };
  for (const chain of flowChains(components, edges)) {
    chain.forEach((label, i) => push(i === 0 ? ', ' : ' → ', `[${label}]`));
  }
  if (line) rows.push(line);
  return rows;
}

function decidedRows(decisions, { dropWhy, decisionsCap }) {
  const shown = decisions.slice(0, decisionsCap);
  const out = [];
  for (const d of shown) {
    out.push(`● ${d.chose}  over  ${d.over}`);
    if (!dropWhy && d.why) out.push(`  ${d.why}`);
  }
  if (decisions.length > shown.length) out.push(`+${decisions.length - shown.length} more`);
  return out;
}

function verifiedRows(items) {
  return items.map((v) => `${GLYPH[v.result]} ${fit(v.check, 28)}  ${v.detail}`.trimEnd());
}

function checkRows(questions, B) {
  const out = [];
  questions.forEach((q, i) => {
    wrapWords(q.q, B - 3, 2).forEach((line, li) => out.push((li === 0 ? `${i + 1}. ` : '   ') + line));
  });
  return out;
}

function build(recap, changes, meta, o, g) {
  const files = `${meta.files} file${meta.files === 1 ? '' : 's'}`;
  const rows = [header(recap.title, `${meta.elapsed} · ${files}`, g)];
  const add = (label, bodyList, second) => {
    if (!bodyList.length) return;
    rows.push(blank(g));
    rows.push(...section(label, bodyList, g, second));
  };
  if (changes && changes.groups.length) add('CHANGED', changedRows(changes, o.changedCap));
  if (recap.components.length) add('FLOW', flowRows(recap.components, recap.edges, o.collapseFlow, g.B));
  if (recap.decisions.length) add('DECIDED', decidedRows(recap.decisions, o));
  if (recap.verification.length) add('VERIFIED', verifiedRows(recap.verification));
  add('CHECK', checkRows(recap.questions, g.B), 'YOURSELF');
  rows.push(footer(g));
  return rows;
}

const TRIM_STEPS = [
  (o) => { o.changedCap = 3; },
  (o) => { o.dropWhy = true; },
  (o) => { o.decisionsCap = 3; },
  (o) => { o.changedCap = 2; },
  (o) => { o.collapseFlow = true; },
];

function layoutCard({ recap, changes = null, meta, width: w = MIN_WIDTH, maxRows = 30 }) {
  const g = geometry(w);
  const o = { changedCap: Infinity, dropWhy: false, decisionsCap: Infinity, collapseFlow: false };
  let rows = build(recap, changes, meta, o, g);
  for (const step of TRIM_STEPS) {
    if (rows.length <= maxRows) break;
    step(o);
    rows = build(recap, changes, meta, o, g);
  }
  if (rows.length > maxRows) throw new LayoutError(`card needs ${rows.length} rows, max ${maxRows}`);
  for (const r of rows) if (width(r) !== g.W) throw new LayoutError(`row is ${width(r)} columns: "${r}"`);
  return rows;
}

module.exports = { layoutCard, flowRows, LayoutError };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/layout.test.js`
Expected: `ℹ pass 20`, `ℹ fail 0`.

If the trim-order test fails at a specific step, print the rows for that budget (`console.log(rows.join('\n'))`) and compare against the spec's section 9 rather than loosening the assertion.

- [ ] **Step 6: Eyeball one card**

Run:
```bash
node -e '
const {validateRecap}=require("./plugins/sprint-recap/scripts/lib/validate");
const {layoutCard}=require("./plugins/sprint-recap/scripts/lib/layout");
const recap=validateRecap(require("./plugins/sprint-recap/tests/fixtures/example.json"));
const changes={git:true,groups:[{name:"src/app",files:3,added:160,removed:8},{name:"prisma",files:1,added:20,removed:1}]};
console.log(layoutCard({recap,changes,meta:{elapsed:"12m",files:4}}).join("\n"));'
```
Expected: a closed box, 70 wide, with CHANGED, FLOW, DECIDED, VERIFIED and CHECK/YOURSELF sections. Confirm visually that the right border is a straight line.

- [ ] **Step 7: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/layout.js plugins/sprint-recap/tests/layout.test.js plugins/sprint-recap/tests/fixtures
git commit -m "$(cat <<'EOF'
Add pure card layout with five-step trimming

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Git measurement primitives

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/git.js`
- Test: `plugins/sprint-recap/tests/git.test.js`

**Interfaces:**
- Produces: `topLevel(cwd)` → real path of repo root, or `null` (not a repo, or git missing).
- Produces: `head(cwd)` → short sha string, or `null` (no commits, or git missing).
- Produces: `refExists(cwd, ref)` → boolean; `false` for falsy ref.
- Produces: `numstat(cwd, ref)` → `{ [path]: [added, removed] }` from `git diff --numstat --no-renames <ref>`; binary files are `[0, 0]`. Throws if git is missing.
- Produces: `untracked(cwd)` → `{ [path]: [lineCount, 0] }` for `git ls-files --others --exclude-standard`, skipping paths with a segment in `SKIP_DIRS` and files over 2 MB (counted as 0 lines).
- Produces: `snapshot(cwd, head)` → `{ ...numstat(cwd, head || EMPTY_TREE), ...untracked(cwd) }`.
- Produces: `delta(current, baseline)` → per path `[max(0, a-ba), max(0, r-br)]`, zero entries dropped.
- Produces: `groupName(path)` → first two directory segments joined with `/`, or the file name for root files.
- Produces: `groupChanges(files)` → `[{ name, files, added, removed }]` sorted by `added+removed` desc, then name.
- Produces: `EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'`, `SKIP_DIRS` (Set).

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/git.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { initRepo, tmpDir, git, write } = require('./helpers');
const g = require('../scripts/lib/git');

test('topLevel and head in and outside a repo', () => {
  const repo = initRepo();
  assert.equal(g.topLevel(path.join(repo)), repo);
  assert.match(g.head(repo), /^[0-9a-f]{7,}$/);
  const plain = tmpDir();
  assert.equal(g.topLevel(plain), null);
  assert.equal(g.head(plain), null);
});

test('head is null in a repo with no commits and snapshot still counts staged files', () => {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  assert.equal(g.head(dir), null);
  write(dir, 'a.txt', 'one\ntwo\n');
  git(dir, ['add', 'a.txt']);
  assert.deepEqual(g.snapshot(dir, null), { 'a.txt': [2, 0] });
});

test('refExists', () => {
  const repo = initRepo();
  assert.equal(g.refExists(repo, g.head(repo)), true);
  assert.equal(g.refExists(repo, 'deadbeef'), false);
  assert.equal(g.refExists(repo, null), false);
});

test('numstat reports working tree versus ref, binary as zeros', () => {
  const repo = initRepo();
  write(repo, 'README.md', 'hello\nworld\n');
  write(repo, 'bin.dat', Buffer.from([0, 1, 2]));
  git(repo, ['add', 'bin.dat']);
  const n = g.numstat(repo, g.head(repo));
  assert.deepEqual(n['README.md'], [1, 0]);
  assert.deepEqual(n['bin.dat'], [0, 0]);
});

test('numstat delta against a baseline survives a commit in between', () => {
  const repo = initRepo();
  const start = g.head(repo);
  write(repo, 'src/x.ts', 'a\nb\nc\n');
  const baseline = g.snapshot(repo, start);
  assert.deepEqual(baseline['src/x.ts'], [3, 0]);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'mid']);
  write(repo, 'src/x.ts', 'a\nb\nc\nd\ne\n');
  write(repo, 'README.md', 'changed\n');
  const current = g.snapshot(repo, start);
  const d = g.delta(current, baseline);
  assert.deepEqual(d['src/x.ts'], [2, 0]);
  assert.deepEqual(d['README.md'], [1, 1]);
});

test('untracked counts lines, including a final line without newline, and skips node_modules', () => {
  const repo = initRepo();
  write(repo, 'notes.txt', 'a\nb\nc');
  write(repo, 'empty.txt', '');
  write(repo, 'node_modules/pkg/index.js', 'x\n');
  const u = g.untracked(repo);
  assert.deepEqual(u['notes.txt'], [3, 0]);
  assert.deepEqual(u['empty.txt'], [0, 0]);
  assert.equal(u['node_modules/pkg/index.js'], undefined);
});

test('delta clamps at zero and drops unchanged files', () => {
  const d = g.delta({ a: [5, 2], b: [1, 1], c: [0, 3] }, { a: [5, 2], b: [4, 4] });
  assert.deepEqual(d, { c: [0, 3] });
});

test('groupName uses the first two directory segments or the root file name', () => {
  assert.equal(g.groupName('src/app/page.tsx'), 'src/app');
  assert.equal(g.groupName('src/app/deep/er/file.ts'), 'src/app');
  assert.equal(g.groupName('prisma/schema.prisma'), 'prisma');
  assert.equal(g.groupName('tests/a.test.js'), 'tests');
  assert.equal(g.groupName('package.json'), 'package.json');
});

test('groupChanges sums per group and sorts by total lines descending', () => {
  const groups = g.groupChanges({
    'src/app/a.ts': [10, 0],
    'src/app/b.ts': [5, 5],
    'prisma/schema.prisma': [30, 1],
    'README.md': [1, 0],
  });
  assert.deepEqual(groups.map((x) => x.name), ['prisma', 'src/app', 'README.md']);
  assert.deepEqual(groups[1], { name: 'src/app', files: 2, added: 15, removed: 5 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/git.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/git'`.

- [ ] **Step 3: Implement git.js**

`plugins/sprint-recap/scripts/lib/git.js`:

```js
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// git's well-known empty tree: lets us diff a repo that has no commits yet.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target']);
const MAX_COUNT_BYTES = 2 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function topLevel(cwd) {
  try { return fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim()); }
  catch { return null; }
}

function head(cwd) {
  try { return git(cwd, ['rev-parse', '--short', 'HEAD']).trim(); }
  catch { return null; }
}

function refExists(cwd, ref) {
  if (!ref) return false;
  try { git(cwd, ['cat-file', '-e', `${ref}^{commit}`]); return true; }
  catch { return false; }
}

function numstat(cwd, ref) {
  const out = git(cwd, ['diff', '--numstat', '--no-renames', ref, '--']);
  const result = {};
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [a, r, ...rest] = line.split('\t');
    result[rest.join('\t')] = [a === '-' ? 0 : Number(a), r === '-' ? 0 : Number(r)];
  }
  return result;
}

function countLines(file) {
  let st;
  try { st = fs.statSync(file); } catch { return 0; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_COUNT_BYTES) return 0;
  const buf = fs.readFileSync(file);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf[buf.length - 1] !== 10) n++;
  return n;
}

function inSkippedDir(rel) {
  return rel.split('/').slice(0, -1).some((seg) => SKIP_DIRS.has(seg));
}

function untracked(cwd) {
  const out = git(cwd, ['ls-files', '--others', '--exclude-standard']);
  const result = {};
  for (const file of out.split('\n')) {
    if (!file || inSkippedDir(file)) continue;
    result[file] = [countLines(path.join(cwd, file)), 0];
  }
  return result;
}

function snapshot(cwd, headRef) {
  return { ...numstat(cwd, headRef || EMPTY_TREE), ...untracked(cwd) };
}

function delta(current, baseline) {
  const out = {};
  for (const [file, [a, r]] of Object.entries(current)) {
    const [ba, br] = baseline[file] || [0, 0];
    const da = Math.max(0, a - ba);
    const dr = Math.max(0, r - br);
    if (da + dr > 0) out[file] = [da, dr];
  }
  return out;
}

function groupName(file) {
  const parts = file.split('/');
  const dirs = parts.slice(0, -1);
  return dirs.length ? dirs.slice(0, 2).join('/') : parts[0];
}

function groupChanges(files) {
  const groups = new Map();
  for (const [file, [a, r]] of Object.entries(files)) {
    const name = groupName(file);
    const x = groups.get(name) || { name, files: 0, added: 0, removed: 0 };
    x.files += 1;
    x.added += a;
    x.removed += r;
    groups.set(name, x);
  }
  return [...groups.values()].sort(
    (p, q) => (q.added + q.removed) - (p.added + p.removed) || p.name.localeCompare(q.name),
  );
}

module.exports = {
  EMPTY_TREE, SKIP_DIRS,
  topLevel, head, refExists, numstat, untracked, snapshot, delta, groupName, groupChanges,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/git.test.js`
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/git.js plugins/sprint-recap/tests/git.test.js
git commit -m "$(cat <<'EOF'
Add git measurement: numstat, untracked, delta, grouping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Shared change measurement (git and mtime)

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/measure.js`
- Test: `plugins/sprint-recap/tests/measure.test.js`

**Interfaces:**
- Consumes: everything from `lib/git.js`.
- Produces: `scanMtime(root, sinceMs, { maxDepth = 4, maxEntries = 5000 })` → `{ files: { [relpath]: [0, 0] }, capped }`. Skips hidden entries and `SKIP_DIRS`.
- Produces: `measure(root, scope)` where `scope = { git, head, baseline, started_at }` → `{ git, files, added, removed, groups, baselineLost, capped }`. In git: `delta(snapshot(root, ref), baseline)`; `baselineLost` is true when `scope.head` is set but no longer exists, in which case the diff is taken against the current HEAD with an empty baseline. Outside git: mtime scan since `started_at`.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/measure.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, tmpDir, git, write } = require('./helpers');
const g = require('../scripts/lib/git');
const { scanMtime, measure } = require('../scripts/lib/measure');

function touchOld(file) {
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(file, old, old);
}

test('scanMtime lists files newer than since, skipping hidden and excluded dirs and deep paths', () => {
  const dir = tmpDir();
  const since = Date.now() - 60_000;
  write(dir, 'notes/a.md', 'x');
  write(dir, 'node_modules/p/i.js', 'x');
  write(dir, '.hidden/h.txt', 'x');
  write(dir, 'a/b/c/d/e.txt', 'x');          // depth 5, excluded
  write(dir, 'a/b/c/d.txt', 'x');            // depth 4, included
  touchOld(write(dir, 'old.txt', 'x'));
  const { files, capped } = scanMtime(dir, since);
  assert.deepEqual(Object.keys(files).sort(), ['a/b/c/d.txt', 'notes/a.md']);
  assert.equal(capped, false);
});

test('scanMtime reports capped past maxEntries', () => {
  const dir = tmpDir();
  for (let i = 0; i < 20; i++) write(dir, `f${i}.txt`, 'x');
  const { capped } = scanMtime(dir, 0, { maxEntries: 5 });
  assert.equal(capped, true);
});

test('measure in git returns grouped delta since the baseline', () => {
  const repo = initRepo();
  const head = g.head(repo);
  write(repo, 'src/a.ts', 'one\n');
  const baseline = g.snapshot(repo, head);
  write(repo, 'src/a.ts', 'one\ntwo\nthree\n');
  write(repo, 'prisma/schema.prisma', 'model X {}\n');
  const m = measure(repo, { git: true, head, baseline, started_at: new Date().toISOString() });
  assert.equal(m.git, true);
  assert.equal(m.files, 2);
  assert.equal(m.added, 3);
  assert.equal(m.removed, 0);
  assert.deepEqual(m.groups.map((x) => x.name), ['src', 'prisma']);
  assert.equal(m.baselineLost, false);
});

test('measure marks baselineLost when the recorded head vanished and diffs against HEAD', () => {
  const repo = initRepo();
  write(repo, 'README.md', 'hello\nmore\n');
  const m = measure(repo, { git: true, head: 'deadbeef', baseline: { 'README.md': [99, 99] }, started_at: new Date().toISOString() });
  assert.equal(m.baselineLost, true);
  assert.equal(m.files, 1);
  assert.equal(m.added, 1);
});

test('measure in a repo with no commits counts staged and untracked files', () => {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  write(dir, 'a.txt', 'one\ntwo\n');
  write(dir, 'b.txt', 'x\n');
  git(dir, ['add', 'a.txt']);
  const m = measure(dir, { git: true, head: null, baseline: {}, started_at: new Date().toISOString() });
  assert.equal(m.baselineLost, false);
  assert.equal(m.files, 2);
  assert.equal(m.added, 3);
});

test('measure outside git counts files by mtime with no line numbers', () => {
  const dir = tmpDir();
  const started = new Date(Date.now() - 60_000).toISOString();
  write(dir, 'docs/a.md', 'x');
  write(dir, 'docs/b.md', 'x');
  write(dir, 'todo.md', 'x');
  const m = measure(dir, { git: false, head: null, baseline: {}, started_at: started });
  assert.equal(m.git, false);
  assert.equal(m.files, 3);
  assert.equal(m.added, 0);
  assert.deepEqual(m.groups.map((x) => [x.name, x.files]), [['docs', 2], ['todo.md', 1]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/measure.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/measure'`.

- [ ] **Step 3: Implement measure.js**

`plugins/sprint-recap/scripts/lib/measure.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/measure.test.js`
Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/measure.js plugins/sprint-recap/tests/measure.test.js
git commit -m "$(cat <<'EOF'
Add shared change measurement for git and plain directories

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: State files, history, error log

**Files:**
- Create: `plugins/sprint-recap/scripts/lib/state.js`
- Test: `plugins/sprint-recap/tests/state.test.js`

**Interfaces:**
- Consumes: `baseDir()` from `lib/config.js`; `topLevel` from `lib/git.js`.
- Produces: `resolveCwd(cwd)` → `{ key, root, git }`. `root` is the real git top level or the real cwd; `key` is 12 hex chars of SHA-1(root).
- Produces: `statePath(key)` → `<baseDir>/sessions/<key>.json`.
- Produces: `readState(key)` → parsed object, or `null` if missing. Throws `SyntaxError` if corrupt.
- Produces: `writeState(key, state)` → atomic write (tmp + rename), creating directories.
- Produces: `newSprint({ head, baseline, now })` → `{ started_at, head, baseline }`.
- Produces: `freshState({ root, git, head, baseline, now })` → `{ cwd: root, git, sprint, turn: null }`.
- Produces: `isHomeOrRoot(dir)` → boolean (compares real paths; home is `os.homedir()`).
- Produces: `historyName(now, basename)` → `YYYY-MM-DD-HHMMSS-<basename>.json` in local time.
- Produces: `writeHistory(entry, root, now)` → written path under `<baseDir>/history/`.
- Produces: `logHookError(hook, err)` → appends `<iso> <hook>: <stack>` to `<baseDir>/hook-errors.log`; never throws.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/state.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRepo, tmpDir, makeHome, write } = require('./helpers');
const state = require('../scripts/lib/state');

test('resolveCwd keys by git top level, or by the directory itself outside git', () => {
  const repo = initRepo();
  fs.mkdirSync(path.join(repo, 'sub'));
  const a = state.resolveCwd(repo);
  const b = state.resolveCwd(path.join(repo, 'sub'));
  assert.equal(a.key, b.key);
  assert.match(a.key, /^[0-9a-f]{12}$/);
  assert.equal(a.root, repo);
  assert.equal(a.git, true);
  const plain = tmpDir();
  const c = state.resolveCwd(plain);
  assert.equal(c.git, false);
  assert.equal(c.root, plain);
  assert.notEqual(c.key, a.key);
});

test('readState returns null when missing, round-trips writes, throws on corrupt JSON', () => {
  process.env.SPRINT_RECAP_HOME = makeHome();
  assert.equal(state.readState('abc'), null);
  const s = state.freshState({ root: '/x', git: false, head: null, baseline: {}, now: new Date('2026-09-12T08:00:00Z') });
  state.writeState('abc', s);
  assert.deepEqual(state.readState('abc'), { cwd: '/x', git: false, sprint: { started_at: '2026-09-12T08:00:00.000Z', head: null, baseline: {} }, turn: null });
  fs.writeFileSync(state.statePath('abc'), '{ nope');
  assert.throws(() => state.readState('abc'), SyntaxError);
});

test('isHomeOrRoot', () => {
  assert.equal(state.isHomeOrRoot(os.homedir()), true);
  assert.equal(state.isHomeOrRoot(path.parse(process.cwd()).root), true);
  assert.equal(state.isHomeOrRoot(tmpDir()), false);
});

test('historyName formats local time and basename', () => {
  const now = new Date(2026, 8, 12, 9, 5, 7);
  assert.equal(state.historyName(now, 'pallisade'), '2026-09-12-090507-pallisade.json');
});

test('writeHistory writes under history/ and returns the path', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  const p = state.writeHistory({ recap: { title: 't' }, card: 'x' }, '/Users/me/proj', new Date(2026, 8, 12, 9, 5, 7));
  assert.equal(p, path.join(home, 'history', '2026-09-12-090507-proj.json'));
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).card, 'x');
});

test('logHookError appends a timestamped line and never throws', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  state.logHookError('check-recap', new Error('boom'));
  const log = fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8');
  assert.match(log, /^\d{4}-\d{2}-\d{2}T.* check-recap: Error: boom/);
  process.env.SPRINT_RECAP_HOME = path.join(write(home, 'file', 'x'), 'not-a-dir');
  assert.doesNotThrow(() => state.logHookError('x', new Error('y')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/state.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/state'`.

- [ ] **Step 3: Implement state.js**

`plugins/sprint-recap/scripts/lib/state.js`:

```js
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baseDir } = require('./config');
const gitlib = require('./git');

// One state file per working directory, keyed by the git top level when there is one.
function resolveCwd(cwd) {
  const top = gitlib.topLevel(cwd);
  const root = top || fs.realpathSync(cwd);
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  return { key, root, git: Boolean(top) };
}

function statePath(key) {
  return path.join(baseDir(), 'sessions', `${key}.json`);
}

function readState(key) {
  const p = statePath(key);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeState(key, state) {
  const p = statePath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

function newSprint({ head, baseline, now }) {
  return { started_at: now.toISOString(), head, baseline };
}

function freshState({ root, git, head, baseline, now }) {
  return { cwd: root, git, sprint: newSprint({ head, baseline, now }), turn: null };
}

function realOrSame(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isHomeOrRoot(dir) {
  const r = realOrSame(dir);
  return r === path.parse(r).root || r === realOrSame(os.homedir());
}

const two = (n) => String(n).padStart(2, '0');

function historyName(now, basename) {
  const d = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const t = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${d}-${t}-${basename}.json`;
}

function writeHistory(entry, root, now) {
  const dir = path.join(baseDir(), 'history');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, historyName(now, path.basename(root) || 'root'));
  fs.writeFileSync(p, JSON.stringify(entry, null, 2));
  return p;
}

// Fail-open support: record the error and let the caller exit 0.
function logHookError(hook, err) {
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
    const text = err && err.stack ? err.stack : String(err);
    fs.appendFileSync(path.join(baseDir(), 'hook-errors.log'), `${new Date().toISOString()} ${hook}: ${text}\n`);
  } catch {
    // Nothing else we can do without risking the user's session.
  }
}

module.exports = {
  resolveCwd, statePath, readState, writeState, newSprint, freshState,
  isHomeOrRoot, historyName, writeHistory, logHookError,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/state.test.js`
Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/lib/state.js plugins/sprint-recap/tests/state.test.js
git commit -m "$(cat <<'EOF'
Add per-directory state, history writer and hook error log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Renderer CLI

**Files:**
- Create: `plugins/sprint-recap/scripts/render.js`
- Test: `plugins/sprint-recap/tests/render.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `validateRecap`/`ValidationError` (Task 4), `layoutCard`/`LayoutError` (Task 5), `head`/`snapshot` (Task 6), `measure` (Task 7), `resolveCwd`/`readState`/`writeState`/`freshState`/`newSprint`/`writeHistory` (Task 8).
- Produces: CLI `node render.js [--cwd <path>] [--width n] [--max-rows n] [--no-git] [--dry-run]`, recap JSON on stdin. Stdout: card rows joined by `\n` plus trailing newline. Exit 0 on success. Exit 1 with a single stderr line `sprint-recap: <field>: <problem>` on any failure.
- Produces: unless `--dry-run`: `turn.recap_rendered_at` set (if a turn exists), `sprint` reset to now with a fresh baseline, and a history file `{ rendered_at, cwd, recap, changes, card }`.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/render.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/render.test.js`
Expected: FAIL. Every test reports `status` of `1` and stderr `Cannot find module`.

- [ ] **Step 3: Implement render.js**

`plugins/sprint-recap/scripts/render.js`:

```js
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
  const changes = measure(ctx.root, {
    git: st.git, head: st.sprint.head, baseline: st.sprint.baseline, started_at: st.sprint.started_at,
  });
  const elapsed = changes.baselineLost ? 'baseline lost' : elapsedLabel(st.sprint.started_at, now);
  return { ctx, st, changes, meta: { elapsed, files: changes.files } };
}

function commit({ ctx, st }, recap, changes, card, now) {
  const head = st.git ? gitlib.head(ctx.root) : null;
  const baseline = st.git ? gitlib.snapshot(ctx.root, head) : {};
  if (st.turn) st.turn.recap_rendered_at = now.toISOString();
  st.sprint = state.newSprint({ head, baseline, now });
  state.writeState(ctx.key, st);
  state.writeHistory({ rendered_at: now.toISOString(), cwd: ctx.root, recap, changes, card }, ctx.root, now);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/render.test.js`
Expected: `ℹ pass 10`, `ℹ fail 0`.

- [ ] **Step 5: Try it by hand from the repo root**

Run:
```bash
SPRINT_RECAP_HOME=$(mktemp -d) node plugins/sprint-recap/scripts/render.js --dry-run < plugins/sprint-recap/tests/fixtures/example.json
```
Expected: exit 0 and a card whose CHANGED section lists this repo's uncommitted work (or no CHANGED section if the tree is clean).

- [ ] **Step 6: Commit**

```bash
git add plugins/sprint-recap/scripts/render.js plugins/sprint-recap/tests/render.test.js
git commit -m "$(cat <<'EOF'
Add render.js: validate, measure, lay out, record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: UserPromptSubmit hook `stamp-turn.js`

**Files:**
- Create: `plugins/sprint-recap/scripts/stamp-turn.js`
- Test: `plugins/sprint-recap/tests/stamp-turn.test.js`

**Interfaces:**
- Consumes: `resolveCwd`, `readState`, `writeState`, `freshState`, `isHomeOrRoot`, `logHookError` (Task 8); `head`, `snapshot` (Task 6).
- Produces: reads hook JSON `{ cwd, ... }` on stdin. Ensures a state file exists (fresh sprint whose baseline is the current snapshot), sets `turn = { started_at, head, baseline, recap_rendered_at: null }`, adds `turn.skip = true` for home or filesystem root. Corrupt state is logged and replaced. Always exits 0 with no stdout.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/stamp-turn.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, tmpDir, makeHome, write, run } = require('./helpers');
const state = require('../scripts/lib/state');
const g = require('../scripts/lib/git');

function stamp(cwd, home, extraEnv = {}) {
  return run('stamp-turn.js', { input: JSON.stringify({ cwd, hook_event_name: 'UserPromptSubmit' }), env: { SPRINT_RECAP_HOME: home, ...extraEnv } });
}

test('git repo: creates state with sprint and turn baselines', () => {
  const home = makeHome();
  const repo = initRepo();
  write(repo, 'new.txt', 'a\nb\n');
  const r = stamp(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(repo).key);
  assert.equal(st.cwd, repo);
  assert.equal(st.git, true);
  assert.equal(st.sprint.head, g.head(repo));
  assert.deepEqual(st.sprint.baseline['new.txt'], [2, 0]);
  assert.deepEqual(st.turn.baseline['new.txt'], [2, 0]);
  assert.equal(st.turn.head, g.head(repo));
  assert.equal(st.turn.recap_rendered_at, null);
  assert.equal(st.turn.skip, undefined);
  assert.ok(Date.parse(st.turn.started_at) > Date.now() - 10_000);
});

test('plain directory: git false and empty baselines', () => {
  const home = makeHome();
  const dir = tmpDir();
  assert.equal(stamp(dir, home).status, 0);
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(dir).key);
  assert.equal(st.git, false);
  assert.equal(st.turn.head, null);
  assert.deepEqual(st.turn.baseline, {});
});

test('home directory: turn.skip is set', () => {
  const home = makeHome();
  const fakeHome = tmpDir();
  assert.equal(stamp(fakeHome, home, { HOME: fakeHome }).status, 0);
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(fakeHome).key);
  assert.equal(st.turn.skip, true);
});

test('a second prompt keeps the sprint and resets recap_rendered_at', () => {
  const home = makeHome();
  const repo = initRepo();
  stamp(repo, home);
  process.env.SPRINT_RECAP_HOME = home;
  const key = state.resolveCwd(repo).key;
  const st = state.readState(key);
  const sprintStart = st.sprint.started_at;
  st.turn.recap_rendered_at = '2026-09-12T09:00:00.000Z';
  state.writeState(key, st);
  write(repo, 'later.txt', 'x\n');
  stamp(repo, home);
  const again = state.readState(key);
  assert.equal(again.sprint.started_at, sprintStart);
  assert.equal(again.turn.recap_rendered_at, null);
  assert.deepEqual(again.turn.baseline['later.txt'], [1, 0]);
});

test('corrupt state is logged and replaced', () => {
  const home = makeHome();
  const repo = initRepo();
  process.env.SPRINT_RECAP_HOME = home;
  const key = state.resolveCwd(repo).key;
  fs.mkdirSync(path.dirname(state.statePath(key)), { recursive: true });
  fs.writeFileSync(state.statePath(key), '{ broken');
  const r = stamp(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(state.readState(key).turn);
  assert.match(fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8'), /stamp-turn/);
});

test('garbage stdin still exits 0 silently', () => {
  const r = run('stamp-turn.js', { input: 'not json', env: { SPRINT_RECAP_HOME: makeHome() }, cwd: tmpDir() });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/stamp-turn.test.js`
Expected: FAIL. `status` is `1`, not `0` (module not found).

- [ ] **Step 3: Implement stamp-turn.js**

`plugins/sprint-recap/scripts/stamp-turn.js`:

```js
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

  const head = ctx.git ? gitlib.head(ctx.root) : null;
  const baseline = ctx.git ? gitlib.snapshot(ctx.root, head) : {};
  if (!st) st = state.freshState({ root: ctx.root, git: ctx.git, head, baseline, now });

  st.turn = { started_at: now.toISOString(), head, baseline, recap_rendered_at: null };
  if (state.isHomeOrRoot(ctx.root)) st.turn.skip = true;
  state.writeState(ctx.key, st);
}

try { main(); } catch (e) { state.logHookError('stamp-turn', e); }
process.exit(0);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/stamp-turn.test.js`
Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sprint-recap/scripts/stamp-turn.js plugins/sprint-recap/tests/stamp-turn.test.js
git commit -m "$(cat <<'EOF'
Add UserPromptSubmit hook that stamps the turn baseline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Stop hook `check-recap.js`

**Files:**
- Create: `plugins/sprint-recap/scripts/check-recap.js`
- Test: `plugins/sprint-recap/tests/check-recap.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 2); `measure` (Task 7); `resolveCwd`, `readState`, `logHookError` (Task 8).
- Produces: reads hook JSON `{ cwd, stop_hook_active, ... }` on stdin. Decision table in order: (1) `stop_hook_active` → allow; (2) no state, no turn, or `turn.skip` → allow; (3) below thresholds (git: `files < minFiles && lines < minLines`; non-git: `files < minFiles`; also mtime scan capped) → allow; (4) `turn.recap_rendered_at` set → allow; (5) otherwise print `{"decision":"block","reason":"..."}`. Always exits 0. Errors are logged and swallowed.

- [ ] **Step 1: Write the failing test**

`plugins/sprint-recap/tests/check-recap.test.js`:

```js
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
  assert.equal(JSON.parse(r.stdout).decision, 'block');
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/sprint-recap/tests/check-recap.test.js`
Expected: FAIL. Blocking tests fail with `Unexpected end of JSON input` because there is no stdout yet; status is `1`.

- [ ] **Step 3: Implement check-recap.js**

`plugins/sprint-recap/scripts/check-recap.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/sprint-recap/tests/check-recap.test.js`
Expected: `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "plugins/sprint-recap/tests/*.test.js"`
Expected: `ℹ fail 0` across all files.

- [ ] **Step 6: Commit**

```bash
git add plugins/sprint-recap/scripts/check-recap.js plugins/sprint-recap/tests/check-recap.test.js
git commit -m "$(cat <<'EOF'
Add Stop hook that blocks until a recap card is rendered

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Hook wiring, skill, READMEs, install and smoke test

**Files:**
- Create: `plugins/sprint-recap/hooks/hooks.json`
- Create: `plugins/sprint-recap/skills/sprint-recap/SKILL.md`
- Create: `plugins/sprint-recap/README.md`
- Create: `README.md`

**Interfaces:**
- Consumes: the three CLI scripts from Tasks 9–11.
- Produces: an installable plugin exposed as `/sprint-recap:sprint-recap`.

- [ ] **Step 1: Write hooks.json**

`plugins/sprint-recap/hooks/hooks.json`:

```json
{
  "description": "Sprint recap: stamp each turn, block the stop until a recap card has been rendered",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stamp-turn.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/check-recap.js\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write SKILL.md**

`plugins/sprint-recap/skills/sprint-recap/SKILL.md`:

````markdown
---
name: sprint-recap
description: Use when finishing a chunk of coding work, before writing any prose summary of what was done, when a Stop hook asks for a recap card, or when the user asks for a recap or types /sprint-recap. Renders a one-screen visual sprint card in the terminal and ends the turn with two comprehension questions.
---

# Sprint Recap

Replace the end-of-work prose summary with a rendered card and two comprehension
questions. A script draws the card from JSON you write and measures the change
from git itself. You never draw boxes, never type line counts, and never write a
prose summary alongside the card.

**Plugin root:** two directories above this skill's base directory. If the base
directory is `<root>/skills/sprint-recap`, the renderer is
`<root>/scripts/render.js`.

## 1. Gather

Before writing any JSON, collect from the work you just did:

- The components you touched and how they connect. At most 6, labels at most 22
  characters. Think in layers (page, router, model, script), not files.
- Every judgment call and the alternative you rejected. At most 5.
- Every verification step and its real result. Anything you did not actually
  run is `unverified` or `skipped`, never `pass`.

## 2. Write two comprehension questions

Each question tests whether the user understands *why* the change works the way
it does. Each has a short model answer you will grade against.

- Good: "Why does the router own type detection instead of the model?"
- Good: "What breaks if the baseline is stored against the working tree instead of HEAD?"
- Bad: "Which file did we edit?" (memorising paths)
- Bad: "Do you like this approach?" (opinion)
- Bad: "Did we run the tests?" (checklist)

The user must be able to answer from having followed the work.

## 3. Render

Pipe the JSON into the renderer. Run it from the project directory, or pass
`--cwd <project>`.

```bash
node "<plugin-root>/scripts/render.js" <<'JSON'
{
  "title": "Artefacts registry v1",
  "components": [
    { "id": "ui",  "label": "/artifacts page" },
    { "id": "api", "label": "artefact router" },
    { "id": "db",  "label": "Artefact model" }
  ],
  "edges": [["ui", "api"], ["api", "db"]],
  "decisions": [
    { "chose": "polymorphic table", "over": "one table per type", "why": "single list query" }
  ],
  "verification": [
    { "check": "vitest artefacts", "result": "pass", "detail": "14/14" },
    { "check": "manual click-through", "result": "skipped" }
  ],
  "questions": [
    { "q": "Which layer decides an artefact's type?", "a": "the router, from the agent payload" },
    { "q": "Why one table instead of one per type?", "a": "single list query for the registry" }
  ]
}
JSON
```

Only `title` and `questions` are required. Empty sections are left out of the
card.

On exit 1 the single stderr line names the field to fix, for example
`sprint-recap: decisions[1].why: must be 0 to 50 characters, got 63`. Fix that
field and rerun. If it still fails after three attempts, paste the error and stop.

## 4. Reply

Paste the renderer's stdout verbatim inside a fenced code block. After the
block add exactly one line:

```
Answer the two questions when ready.
```

No other summary. No bullet list of what changed, no "next steps", no
restating the decisions. The card is the summary. End the turn.

## 5. Grade on the next message

If the user's next message answers the questions, reply with one line per
question, then carry on with whatever else the message asked:

```
1. Correct.
2. Not quite: <at most two sentences drawn from the model answer>.
```

The model answers are in the conversation, in the render command you ran. If
context compaction dropped them, grade from your own understanding of the work.

- If the user answers only one question, grade that one and answer the other
  yourself in one line.
- If the user ignores the questions and gives a new instruction, answer both
  questions yourself in one line each, then proceed with the instruction.
- Never ask the questions again.

## 6. Manual use

When invoked via `/sprint-recap` (or `/sprint-recap:sprint-recap`) with no
threshold met, still render. Everything since the last rendered recap counts as
the sprint.

## Limits the renderer enforces

Do not spend a run discovering these.

| Field | Limit |
|---|---|
| `title` | 1–28 characters |
| `components` | 0–6; `id` unique; `label` 1–22 |
| `edges` | pairs of known `id`s |
| `decisions` | 0–5; `chose` and `over` 1–20; `why` 0–50 |
| `verification` | 0–5; `check` 1–28; `result` one of `pass`, `fail`, `skipped`, `unverified`; `detail` 0–20 |
| `questions` | exactly 2 (configurable); `q` 1–98; `a` 1–200 |
| characters | plain ASCII and Latin letters only; wide characters and emoji become `?` |

Model answers (`a`) are never printed on the card.
````

- [ ] **Step 3: Write the plugin README**

`plugins/sprint-recap/README.md`:

````markdown
# sprint-recap

Replaces Claude Code's end-of-work prose with a one-screen, box-drawn recap
card and two comprehension questions. A Stop hook blocks the turn until the
card has been rendered whenever enough files changed.

Design: `docs/superpowers/specs/2026-09-12-sprint-recap-design.md`.

## Install

```bash
claude plugin marketplace add ~/Claude/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

After editing the plugin:

```bash
claude plugin update sprint-recap
```

Claude Code copies the plugin into its cache on install, so edits are not live
until you update and restart the session.

The skill is `/sprint-recap:sprint-recap`. Depending on the Claude Code
version the short `/sprint-recap` form also resolves.

## How it works

1. `UserPromptSubmit` runs `scripts/stamp-turn.js`, which records HEAD and a
   `git diff --numstat` baseline for the turn.
2. `Stop` runs `scripts/check-recap.js`. If at least `minFiles` files or
   `minLines` lines changed since the prompt and no card was rendered, it
   blocks with a reason that tells Claude to use the skill.
3. The skill has Claude write recap JSON and pipe it into `scripts/render.js`,
   which validates, measures the sprint from git, lays out the card, prints it,
   and records history.

Nothing is written inside your project. State lives in
`~/.claude/sprint-recap/`:

| Path | Purpose |
|---|---|
| `config.json` | optional overrides, see below |
| `sessions/<cwd-hash>.json` | one state file per working directory |
| `history/<date>-<time>-<dir>.json` | every rendered recap |
| `hook-errors.log` | hook failures (hooks always fail open) |

Set `SPRINT_RECAP_HOME` to relocate that directory. Tests do this.

## Config

`~/.claude/sprint-recap/config.json` overrides any key of
`scripts/defaults.json`:

```json
{
  "minFiles": 2,
  "minLines": 20,
  "width": 70,
  "maxRows": 30,
  "questions": 2
}
```

## Renderer

```bash
node scripts/render.js [--cwd <path>] [--width n] [--max-rows n] [--no-git] [--dry-run] < recap.json
```

`--no-git` skips measurement; `--dry-run` skips state and history writes. Exit
1 with one stderr line on validation failure.

## Tests

```bash
node --test "plugins/sprint-recap/tests/*.test.js"
```

Tests create temporary git repos and an isolated `SPRINT_RECAP_HOME`; they
never touch real state.

## Manual smoke test

1. `mkdir /tmp/recap-smoke && cd /tmp/recap-smoke && git init` and open Claude
   Code there.
2. Ask Claude to create two files with 15 lines each. Confirm the Stop hook
   blocks and a card renders.
3. Answer the questions. Confirm grading and no second card.
4. Ask a read-only question. Confirm no card.
5. Run `/sprint-recap:sprint-recap`. Confirm a card renders with the sprint
   since step 2.

If a hook misbehaves, read `~/.claude/sprint-recap/hook-errors.log`.
````

- [ ] **Step 4: Write the repo README**

`README.md`:

```markdown
# emil-plugins

Local Claude Code plugin marketplace.

| Plugin | What it does |
|---|---|
| [sprint-recap](plugins/sprint-recap/) | One-screen visual recap card with comprehension questions, enforced by a Stop hook |

## Install

```bash
claude plugin marketplace add ~/Claude/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

## Develop

Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.

```bash
npm test
claude plugin validate .
```

After changing a plugin: `claude plugin update <name>` and restart the session.
```

- [ ] **Step 5: Validate the plugin and run the suite**

Run:
```bash
claude plugin validate . && claude plugin validate plugins/sprint-recap && npm test
```
Expected: validation passes for both paths, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/sprint-recap/hooks plugins/sprint-recap/skills plugins/sprint-recap/README.md README.md
git commit -m "$(cat <<'EOF'
Wire hooks, add sprint-recap skill and READMEs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Install the marketplace and plugin**

Run:
```bash
claude plugin marketplace add ~/Claude/claude-plugins
claude plugin install sprint-recap@emil-plugins
claude plugin list
```
Expected: `sprint-recap@emil-plugins` listed as installed. If the marketplace was already added from an earlier attempt, run `claude plugin marketplace update emil-plugins` instead of `add`.

- [ ] **Step 8: Verify the hooks fire from the installed copy**

Run:
```bash
ROOT=$(node -e 'const p=require(process.env.HOME+"/.claude/plugins/installed_plugins.json");console.log(p.plugins["sprint-recap@emil-plugins"][0].installPath)')
cd "$(mktemp -d)" && git init -q && echo '{"cwd":"'"$PWD"'"}' | node "$ROOT/scripts/stamp-turn.js"; echo "stamp exit=$?"
printf 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\n' > a.txt; cp a.txt b.txt
echo '{"cwd":"'"$PWD"'","stop_hook_active":false}' | node "$ROOT/scripts/check-recap.js"
```
Expected: `stamp exit=0`, then one JSON line with `"decision":"block"` and `2 files (+22 -0)`.

- [ ] **Step 9: Run the manual smoke test from the plugin README in a fresh Claude Code session**

Follow the five README steps in `/tmp/recap-smoke`. Record the result (pass, or the exact failure) in the final report. If step 2 does not block, check `~/.claude/sprint-recap/hook-errors.log` and `claude plugin list` before changing code.

---

## Self-review notes

**Spec coverage.** Section 4 layout → Tasks 1, 12 (plus the three extra lib files listed under Deviations). Section 5 install → Task 12 steps 7–8 and README. Section 6 state → Task 8, Task 10. Section 7 JSON constraints → Task 4. Section 8 renderer steps 1–7 and flags → Task 9. Section 9 layout, glyphs, sections, trim order, 70-wide assertion, max fixture → Task 5. Section 10 hooks.json, stamp-turn steps, check-recap decision table, block payload, fail-open → Tasks 10, 11, 12. Section 11 config → Task 2. Section 12 skill body items 1–6 and enforced limits → Task 12. Section 13 tests: layout, render, check-recap, stamp-turn, git all present; smoke test in README → Task 12. Section 14 edge cases: mid-task pause (hook behaviour, Task 11), commits during sprint (Task 6 test), rebase/checkout → `baseline lost` (Task 7 test, Task 9 meta), large non-git dirs cap (Task 7 scan cap, Task 11 allows on `capped`), renderer outside a project (no CHANGED section, Task 5 "empty sections are omitted"), one answered question (SKILL.md section 5).

**Type consistency.** `changes` shape `{ git, files, added, removed, groups, baselineLost, capped }` is produced by `measure` (Task 7) and consumed by `layoutCard` (uses `git`, `groups`), `render.js` (uses `files`, `baselineLost`) and `check-recap.js` (uses `files`, `added`, `removed`, `git`, `capped`). `meta` is `{ elapsed, files }` everywhere. State shape `{ cwd, git, sprint: { started_at, head, baseline }, turn: { started_at, head, baseline, recap_rendered_at, skip? } | null }` is produced by Task 8 and Task 10 and consumed by Tasks 9 and 11. `resolveCwd` returns `{ key, root, git }` and is used identically in Tasks 9, 10, 11 and their tests.
