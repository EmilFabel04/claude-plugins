# Sprint Recap plugin: design

Date: 2026-09-12
Status: approved design, pending implementation plan

## 1. Purpose

When Claude Code finishes a chunk of coding work it normally ends with a wall of
prose that is easy to skim and forget. Sprint Recap replaces that prose with a
one-screen, box-drawn card rendered in the terminal: real change numbers from
git, a small flow diagram of the components touched, the decisions taken, what
was and was not verified, and two comprehension questions the user must answer
before work continues. The goal is that the user stays involved in and
understands the work, not that the summary looks pretty.

## 2. Decisions taken during brainstorming

| Topic | Decision |
|---|---|
| Surface | Rich terminal output inside Claude's reply, in a fenced code block. No browser, no separate process. |
| Trigger | Automatic and enforced by a Stop hook, plus manual `/sprint-recap`. |
| Sections | Changed-files bars, flow diagram, decisions with trade-offs, verification status. |
| Engagement | Two comprehension questions that test the user's understanding of the change. Claude waits for answers and grades them. Not opinion questions, not a checklist. |
| Size | Hard cap: 70 columns by 30 rows including borders. Content is trimmed, the card never grows. |
| Rendering | Structured JSON written by Claude, rendered by a deterministic Node script. Claude never hand-draws boxes or types line counts. |
| Packaging | Claude Code plugin inside a one-plugin local marketplace repo. |

## 3. Non-goals

- No colours. Claude's markdown output does not carry ANSI codes, so the card is monochrome by design.
- No browser dashboard or history UI. Recaps are saved to disk so one could be built later, but nothing reads them yet.
- No per-project configuration. One user-level config file.
- No support for Codex, Gemini CLI, or Cursor hook formats.

## 4. Repository layout

```
~/Claude/claude-plugins/                        git repo, local marketplace
  .claude-plugin/marketplace.json               name "emil-plugins", lists ./plugins/sprint-recap
  README.md
  docs/superpowers/specs/                       this document and future specs
  plugins/sprint-recap/
    .claude-plugin/plugin.json                  name, version, description, author
    skills/sprint-recap/SKILL.md                when and how Claude produces a recap
    hooks/hooks.json                            UserPromptSubmit and Stop wiring
    scripts/
      render.js                                 JSON in, boxed card out
      stamp-turn.js                             UserPromptSubmit hook
      check-recap.js                            Stop hook
      lib/
        state.js                                state file read/write
        git.js                                  numstat, untracked files, head
        layout.js                               pure card layout, no IO
        config.js                               defaults merged with user config
      defaults.json                             shipped default config
    tests/
      render.test.js
      layout.test.js
      check-recap.test.js
      stamp-turn.test.js
      git.test.js
      fixtures/
    README.md
```

All scripts are plain Node with zero npm dependencies. Tests use `node --test`.

## 5. Install and update

```
claude plugin marketplace add ~/Claude/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

After editing the plugin: `claude plugin update sprint-recap`. Claude Code copies
the plugin into its cache on install, so edits are not live until updated.

The skill is exposed as `/sprint-recap:sprint-recap`. Whether the short
`/sprint-recap` form also resolves depends on the Claude Code version; the
namespaced form always works and the README documents both.

## 6. Runtime state

Nothing is written inside project repos. All state lives under
`~/.claude/sprint-recap/`:

```
~/.claude/sprint-recap/
  config.json                       optional user overrides, see section 11
  sessions/<cwd-hash>.json          one state file per working directory
  history/<YYYY-MM-DD>-<HHMMSS>-<cwd-basename>.json   every rendered recap, see section 8 step 7
```

`cwd-hash` is the first 12 hex characters of the SHA-1 of the real path of the
git top level, or of the cwd when not in git. Keying by directory rather than
session ID lets the renderer, which Claude runs from the skill, find the same
file the hooks use without Claude needing to know the session ID. Two concurrent
sessions in the same directory share a state file. This is accepted: the worst
case is one session getting a free pass on a turn where the other rendered.

State file shape:

```json
{
  "cwd": "/Users/emilfabel/pallisade-copilot",
  "git": true,
  "sprint": {
    "started_at": "2026-09-12T08:12:00.000Z",
    "head": "a1b2c3d",
    "baseline": { "src/x.ts": [4, 1] }
  },
  "turn": {
    "started_at": "2026-09-12T08:40:00.000Z",
    "head": "a1b2c3d",
    "baseline": { "src/x.ts": [4, 1], "src/y.ts": [10, 0] },
    "recap_rendered_at": null
  }
}
```

`baseline` maps a repo-relative path to `[added, removed]` as reported by
`git diff --numstat <head>` for the working tree at that moment, plus untracked
files as `[lineCount, 0]`. A sprint is everything since the last rendered recap
or since the state file was created. A turn is everything since the last user
prompt.

## 7. Recap JSON written by Claude

Claude writes this and pipes it into the renderer on stdin. All fields except
`title` and `questions` are optional; empty sections are omitted from the card.

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

Constraints enforced by the renderer, which exits 1 with a one-line message if
violated:

- `title`: 1 to 28 characters, so the header fits without cutting.
- `components`: 0 to 6 entries. `id` unique, `label` 1 to 22 characters.
- `edges`: pairs of known ids. Unknown ids are an error.
- `decisions`: 0 to 5 entries. `chose` and `over` 1 to 20 characters, `why` 0 to 50.
- `verification`: 0 to 5 entries. `check` 1 to 28 characters. `result` is one of `pass`, `fail`, `skipped`, `unverified`. `detail` 0 to 20 characters.
- `questions`: exactly the configured count, default 2. `q` 1 to 98 characters (wraps to two rows), `a` 1 to 200. Model answers are never printed.
- Every string must consist of code points with East Asian Width Neutral, Narrow, or Half-width, and no emoji presentation. Anything else is replaced with `?` so the card cannot misalign.

## 8. Renderer: `render.js`

Invocation from the skill, with the plugin root taken from the base directory
Claude Code announces when the skill loads:

```
node "<plugin-root>/scripts/render.js" <<'JSON'
{ ...recap json... }
JSON
```

Optional flags: `--cwd <path>` (default: process cwd), `--width`, `--max-rows`,
`--no-git` (skip measurement, used by tests), `--dry-run` (do not touch state
or history).

Steps:

1. Parse and validate stdin JSON per section 7.
2. Load state for the cwd. If none exists, create one with a sprint that starts now and an empty baseline. The card then shows the whole working-tree diff versus HEAD.
3. Measure. In a git repo: `numstat(worktree vs sprint.head)` minus `sprint.baseline`, clamped at zero, plus untracked files. Drop files with zero delta. Group by the first two path segments (`src/app`, `prisma`, `tests`); files at the repo root group under their own name. Sort by total lines descending. Outside git: list files newer than `sprint.started_at` under the cwd, depth 4, skipping hidden directories and `node_modules`, `dist`, `build`, `.next`, `__pycache__`, `.venv`, `venv`, `target`. Show file counts, no bars.
4. Elapsed time is now minus `sprint.started_at`, shown as `Nm` under an hour, `Nh Nm` otherwise.
5. Lay out the card with `layout.js` (pure, section 9).
6. Print the card to stdout.
7. Unless `--dry-run`: set `turn.recap_rendered_at`, reset `sprint` to start now with a fresh baseline at the current head, and write `history/<YYYY-MM-DD>-<HHMMSS>-<cwd-basename>.json` containing the recap JSON, the measured changes, and the rendered card text.

Exit 0 on success. Exit 1 with a single stderr line on validation failure so
Claude can fix the JSON and rerun.

## 9. Card layout: `layout.js`

Fixed width of 70 columns including the two border characters, so 68 columns
inside. A two-space left margin and two-space right margin leave 64 content
columns. The first 12 content columns are the section label gutter, leaving 52
columns for section bodies. All per-field limits in section 7 are derived from
that 52-column budget. Maximum 30 rows including top and bottom border.

Glyphs: box drawing `╭ ╮ ╰ ╯ │ ─`, bars `█`, bullets `●`, verification
`✓ ✗ ○ ?` for pass, fail, skipped, unverified, arrows `→`. No characters with
ambiguous or wide East Asian Width.

Header row: `╭─ Sprint recap · <title> ` padded with `─`, then
` <elapsed> · <n> files ─╮`. If the title does not fit, it is cut with `…`.

Sections in order, each preceded by one blank row, with a 12-column label
gutter (`CHANGED`, `FLOW`, `DECIDED`, `VERIFIED`, `CHECK` / `YOURSELF`):

- **CHANGED**: one row per group: path padded or cut to 18, one space, bar of up to 16 `█` scaled linearly to the largest group with a minimum of 1 for any non-zero group, one space, then `+added` right-aligned in 6 and `-removed` right-aligned in 5. Total 47 of 52. Outside git the bar and counts are replaced with `<n> files`.
- **FLOW**: nodes as `[label]` joined by ` → `. Laid out left to right following edges from the node with no incoming edge. When a row would exceed 64 columns, it wraps to a second row indented under the first node. Nodes with no edges are listed after, comma separated. Disconnected graphs and cycles are laid out in input order with arrows only where edges exist.
- **DECIDED**: one row per decision: `● <chose>  over  <over>` (2 + 20 + 8 + 20 = 50 of 52), then a second row indented two columns with `why` if present (2 + 50 = 52).
- **VERIFIED**: one row per check: `<glyph> <check>  <detail>` (2 + 28 + 2 + 20 = 52).
- **CHECK YOURSELF**: `1. <q>` and `2. <q>`, wrapped at word boundaries to at most two rows of 49 characters after the 3-character number prefix.

Trimming when the row budget is exceeded, applied in this order until the card
fits:

1. Collapse changed groups beyond the top 3 into one row `+<n> more`.
2. Drop `why` rows from decisions.
3. Cap decisions at 3, adding `+<n> more` on the last row.
4. Cap changed groups at 2.
5. Collapse the flow diagram to a single row `<n> components, <m> edges`.

Verification rows and questions are never trimmed. Worst case at every
section 7 maximum before trimming: header 1, CHANGED 4 (top 3 plus more-row),
FLOW 5, DECIDED 10, VERIFIED 5, CHECK 4, five blank separators, footer 1, total
35 (39 with eight changed groups before step 1). Steps 1 and 2 bring the eight-group case to exactly 30, so the renderer never needs to fail. It
still exits 1 with a clear message if a bug ever pushes it past all five steps,
and a test asserts the maximum fixture fits.

Every output row is exactly 70 code points. A test asserts this for every
fixture.

## 10. Hooks

`hooks/hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stamp-turn.js\"", "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/check-recap.js\"", "timeout": 15 } ] }
    ]
  }
}
```

Both scripts read the hook JSON from stdin, using `cwd` from it. Both exit 0
with no stdout on the allow path so nothing is injected into Claude's context.

### `stamp-turn.js`

1. Resolve the state file for `cwd`. Create it with a new sprint if missing.
2. Set `turn.started_at` to now, `turn.head` to the current HEAD, `turn.baseline` to the current numstat, and `turn.recap_rendered_at` to null.
3. If `cwd` is the home directory or filesystem root, write the state but mark `turn.skip = true` so the Stop hook never scans it.

### `check-recap.js`

Decision order. The first matching rule wins.

| # | Condition | Result |
|---|---|---|
| 1 | `stop_hook_active` is true in the input | allow |
| 2 | No state file, or `turn.skip` is true | allow |
| 3 | Changed files since `turn.started_at` below both thresholds: fewer than `minFiles` files and fewer than `minLines` lines added plus removed | allow |
| 4 | `turn.recap_rendered_at` is set | allow |
| 5 | Otherwise | block |

Change detection mirrors the renderer: numstat versus `turn.head` minus
`turn.baseline` plus untracked files in git; mtime scan with the same
exclusions outside git, where lines are unknown and only `minFiles` applies.

Block output, exit 0:

```json
{
  "decision": "block",
  "reason": "sprint-recap: 4 files (+186 -12) changed this turn and no recap card has been rendered. Invoke the sprint-recap skill with the Skill tool and render the card before finishing."
}
```

Fail-open policy: any thrown error in either hook is caught, written to
`~/.claude/sprint-recap/hook-errors.log` with a timestamp, and the hook exits 0
with no output. A plugin bug can never trap the user in a session.

## 11. Config

`scripts/defaults.json` ships with the plugin. `~/.claude/sprint-recap/config.json`
overrides any key and survives plugin updates.

```json
{
  "minFiles": 2,
  "minLines": 20,
  "width": 70,
  "maxRows": 30,
  "questions": 2
}
```

## 12. Skill: `SKILL.md`

Frontmatter:

```
name: sprint-recap
description: Use when finishing a chunk of coding work, before writing any prose summary of what was done, when a Stop hook asks for a recap card, or when the user asks for a recap or types /sprint-recap. Renders a one-screen visual sprint card in the terminal and ends the turn with two comprehension questions.
```

Body, in order:

1. **Gather.** List the components touched and how they connect, every judgment call and the alternative rejected, and every verification step with its real result. Anything not run is `unverified` or `skipped`, never `pass`.
2. **Write two comprehension questions** that test understanding of why the change works the way it does. Each has a short model answer. Good: "Why does the router own type detection instead of the model?" Bad: "Which file did we edit?" The user has to be able to answer from having followed the work, not from memorising paths.
3. **Render.** Pipe the JSON into `render.js` using the plugin root from the skill's base directory. On exit 1, fix the reported field and rerun.
4. **Reply.** Paste the renderer output verbatim in a fenced code block. Add exactly one line after it: "Answer the two questions when ready." No other prose summary. Then end the turn.
5. **Grade on the next message.** If the user's message answers the questions, reply with one line per question: `1. Correct.` or `1. Not quite:` followed by at most two sentences of correction drawn from the model answer. Then carry on with whatever else the message asked. The model answers are in the conversation from the render command. If context compaction has dropped them, grade from your own understanding of the work. If the user ignores the questions and gives a new instruction, answer both questions yourself in one line each and proceed. Never ask again.
6. **Manual use.** When invoked via `/sprint-recap` with no threshold met, still render. Everything since the last recap counts as the sprint.

The skill also states what the renderer already enforces so Claude does not
waste a run: character limits, no wide characters, exactly two questions.

## 13. Testing

All tests run with `node --test plugins/sprint-recap/tests`.

- `layout.test.js`: for every fixture, every row is exactly 70 code points and row count is at most 30. Trim order: a fixture with 8 changed groups, 5 decisions with reasons, and 6 components triggers steps 1 to 5 in sequence, asserted by checking which rows survive at each budget. Flow wrapping past 64 columns. Disconnected graph and cycle handling. A fixture at every input maximum from section 7 fits without exiting.
- `render.test.js`: runs the script as a child process with `--no-git --dry-run` and fixture stdin. Validation failures exit 1 with the right field name. `--dry-run` leaves state and history untouched. Wide characters are replaced with `?`.
- `check-recap.test.js`: one test per row of the decision table in section 10, plus fail-open on a corrupt state file and on a missing git binary. Uses a temporary git repo created in `os.tmpdir()`.
- `stamp-turn.test.js`: state shape after a prompt in a git repo, in a plain directory, and in the home directory (`skip` set). Resets `recap_rendered_at`.
- `git.test.js`: numstat delta against a baseline with a commit in between, untracked file counting, top-two-segment grouping.

Manual smoke test after install, recorded in the plugin README:

1. `mkdir /tmp/recap-smoke && cd /tmp/recap-smoke && git init` and open Claude Code there.
2. Ask Claude to create two files with 15 lines each. Confirm the Stop hook blocks and a card renders.
3. Answer the questions. Confirm grading and no second card.
4. Ask a read-only question. Confirm no card.
5. Run `/sprint-recap`. Confirm a card renders with the sprint since step 2.

## 14. Edge cases

- **Claude pauses mid-task to ask a question after editing files.** The hook blocks and a card renders for the work so far. This is intended: the user gets a checkpoint before answering.
- **Commits during the sprint.** Baselines are stored against the head at sprint start, so `git diff <sprint.head>` still sees the full change.
- **Rebase or checkout during the sprint.** If `sprint.head` no longer exists, the renderer falls back to the working tree versus current HEAD and notes `baseline lost` in the header in place of elapsed time.
- **Large non-git directories.** The mtime scan is capped at depth 4 and 5000 entries. Past the cap it reports the count so far and allows.
- **Renderer invoked outside any project.** Home and root are skipped by the hooks; the renderer still works but shows no CHANGED section.
- **User answers only one question.** Grade the one answered, answer the other in one line, move on.

## 15. Future, explicitly out of scope now

- Browser dashboard reading `history/`.
- Per-project config or opt-out file.
- Difficulty adaptation of questions based on past grading.
