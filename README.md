# claude-plugins

A small [Claude Code](https://claude.com/claude-code) plugin marketplace
(registered as `emil-plugins`) that currently holds one plugin, sprint-recap.
When Claude Code finishes a chunk of coding work it usually ends with a long
prose summary that is easy to skim and forget. sprint-recap replaces that with
a one-screen terminal card built from real git numbers, followed by two
questions that check whether you understood why the change works.

The interesting part is the split of responsibilities. The model supplies
judgment (which components it touched, what it decided, what it verified, what
to ask you) as structured JSON. A deterministic Node renderer validates that
JSON, measures the change from git itself, and lays out the card, so the model
never types a line count or draws a box. A Stop hook enforces the recap, and
both hooks fail open so a plugin bug cannot trap a session. Everything is plain
Node with no npm dependencies, covered by 96 `node --test` tests, many of which
run against real throwaway git repos.

## What's in the marketplace

| Plugin | What it does | When you'd use it |
|---|---|---|
| [sprint-recap](plugins/sprint-recap/) | Ends a coding turn with a one-screen recap card and two comprehension questions, enforced by a Stop hook | You let Claude Code make multi-file changes and want to stay on top of what it did and why, not just read a summary |

## What a recap looks like

```
╭─ Sprint recap · Artefacts registry v1 ────────────── 0m · 3 files ─╮
│                                                                    │
│  CHANGED     src/app            ████████████████   +134    -0      │
│              prisma             ██                  +20    -0      │
│                                                                    │
│  FLOW        [/artifacts page] → [artefact router]                 │
│                → [Artefact model]                                  │
│                                                                    │
│  DECIDED     ● polymorphic table  over  one table per type         │
│                single list query for the registry page             │
│                                                                    │
│  VERIFIED    ✓ vitest artefacts              14/14                 │
│              ○ manual click-through                                │
│                                                                    │
│  CHECK       1. Which layer decides an artefact's type, and why    │
│  YOURSELF       there?                                             │
│              2. Why one polymorphic table instead of one per       │
│                 type?                                              │
╰────────────────────────────────────────────────────────────────────╯
Answer the two questions when ready.
```

CHANGED comes from git, not from Claude. FLOW, DECIDED and VERIFIED come from
the JSON Claude writes; the skill tells it to mark anything it did not actually
run as `skipped` or `unverified`, never `pass`. The questions are meant to test
understanding of the design, not recall of file names. Claude grades your
answers against model answers it wrote alongside the questions (they are never
printed on the card), then carries on with whatever else you asked.

## How it works

The plugin has two hooks, one skill and one renderer script.

1. **`UserPromptSubmit` hook** (`scripts/stamp-turn.js`) records HEAD and a
   `git diff --numstat` baseline, plus line counts for untracked files, each
   time you send a prompt.
2. **`Stop` hook** (`scripts/check-recap.js`) measures what changed since that
   prompt. If at least 2 files or 20 lines changed and no card has been
   rendered this turn, it returns `{"decision": "block"}` with a reason telling
   Claude to use the skill.
3. **Skill** (`skills/sprint-recap/SKILL.md`) tells Claude what to gather, how
   to write good questions, and how to pipe the recap JSON into the renderer.
   It also covers grading on the next message, including when you answer only
   one question or ignore them.
4. **Renderer** (`scripts/render.js`) validates the JSON against strict field
   limits, measures the sprint (everything since the last card) from git, lays
   out the card, prints it, and records a history entry. On invalid input it
   exits 1 with one line naming the field.

Nothing is written inside your project repos. State lives in
`~/.claude/sprint-recap/`.

## Engineering notes

**Facts from code, judgment from the model.** Line counts, file groups and
elapsed time are measured by the renderer, so they cannot be hallucinated. The
model only contributes what it is actually needed for: how the pieces connect,
which alternatives it rejected, and what to ask.

**Errors written for the model to act on.** The validator rejects bad input
with a single line such as
`sprint-recap: decisions[1].why: must be 0 to 50 characters, got 63`. The skill
tells Claude to fix that field and rerun, and to stop after three failed
attempts. The skill also lists every limit up front so Claude does not spend a
run discovering them.

**Measuring "this turn" in git.** A baseline is the working tree's
`--numstat` against the HEAD recorded at prompt time, plus untracked files. The
change for a turn is the current numstat against that same recorded HEAD, minus
the baseline, clamped at zero. That way edits that existed before the prompt
are not counted again, and commits made during the turn are still counted.
Repos with no commits are diffed against git's empty tree. If the recorded HEAD
disappears after a rebase, the renderer falls back to the current HEAD and
shows `baseline lost` in the header instead of an elapsed time. Outside git it
falls back to an mtime scan, capped at depth 4 and 5,000 entries, that skips
`node_modules`, build output and virtualenvs.

**A fixed-size card.** By default the card is 70 columns by 30 rows, and
every row must be exactly the card width in code points. To make code points
equal terminal columns, input is NFC-normalised and restricted to ASCII and
Latin letters; anything else, including emoji and CJK characters, becomes `?`.
When content exceeds the row cap, five trimming steps are applied in a fixed
order.
Verification rows and questions are never trimmed. The design spec works out
the worst case at every field limit, and a test renders that maximum fixture to
check it fits.

**Hooks that cannot trap a session.** Both hooks catch every error, log it to
`~/.claude/sprint-recap/hook-errors.log`, and exit 0. The Stop hook allows
immediately when `stop_hook_active` is set, so it cannot block in a loop. The
home directory and filesystem root are never scanned.

**State keyed by directory, not session.** Claude runs the renderer from the
skill and does not know its session ID, so state is keyed by a hash of the git
top level (or of the directory outside git). The renderer and hooks find the
same file without any coordination.
The trade-off, recorded in the spec, is that two sessions in the same
directory share one state file.

**Spec first.** The [design spec](docs/superpowers/specs/2026-09-12-sprint-recap-design.md)
and the task-by-task [implementation plan](docs/superpowers/plans/2026-09-12-sprint-recap.md)
were written before the code, and the commit history follows the plan one
module at a time.

## Limitations

- The enforcement is strict by design. With the default thresholds almost any
  turn that edits code ends with a card, which can feel like an interruption
  during long sessions. Raising `minFiles` and `minLines` makes it fire less
  often.
- The card is monochrome, because Claude's replies do not carry ANSI colour.
- Configuration is per user, not per project.
- History entries are saved to disk, but nothing reads them yet.

## Install

From GitHub:

```bash
claude plugin marketplace add EmilFabel04/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

From a local clone:

```bash
claude plugin marketplace add /path/to/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

Restart Claude Code after installing. The skill is available as
`/sprint-recap:sprint-recap`; depending on your Claude Code version the short
`/sprint-recap` form also works.

Claude Code copies a plugin into its cache on install, so to pick up changes
after editing it:

```bash
claude plugin marketplace update emil-plugins
claude plugin update sprint-recap
```

## Configure

Optional overrides go in `~/.claude/sprint-recap/config.json`. The defaults are:

```json
{
  "minFiles": 2,
  "minLines": 20,
  "width": 70,
  "maxRows": 30,
  "questions": 2
}
```

| Key | Meaning |
|---|---|
| `minFiles` | Block the turn when at least this many files changed |
| `minLines` | Or when at least this many lines were added plus removed (git repos only) |
| `width` | Card width in columns, minimum 70 |
| `maxRows` | Card height cap; content is trimmed to fit |
| `questions` | Number of comprehension questions the renderer requires |

## Tests

Requires Node 22 or newer and git.

```bash
git clone https://github.com/EmilFabel04/claude-plugins.git
cd claude-plugins
npm test                      # 96 tests with node --test
claude plugin validate .      # marketplace manifest check
```

The tests exercise the library modules directly and run the hook and renderer
scripts as child processes, against real git repos created under
`os.tmpdir()`. They point `SPRINT_RECAP_HOME` at a temp directory, so they
never touch real state. They cover each rule in the Stop
hook's decision table, fail-open behaviour with a corrupt state file and with
no git binary on `PATH`, numstat deltas across a commit, the trimming order,
and the 70-column invariant for every fixture.

CI (`.github/workflows/ci.yml`) checks that every JSON file in the repo parses
and runs `npm test` on Node 22.

## Repository layout

```
.claude-plugin/marketplace.json     marketplace manifest ("emil-plugins")
docs/superpowers/specs/             design spec
docs/superpowers/plans/             implementation plan
plugins/sprint-recap/
  .claude-plugin/plugin.json
  hooks/hooks.json                  UserPromptSubmit + Stop wiring
  skills/sprint-recap/SKILL.md      when and how Claude produces a recap
  scripts/render.js                 JSON in, card out
  scripts/stamp-turn.js             UserPromptSubmit hook
  scripts/check-recap.js            Stop hook
  scripts/lib/                      config, text, validate, layout, git, measure, state
  tests/                            node --test suite and fixtures
  README.md                         renderer flags, state files, manual smoke test
```

The plugin's [README](plugins/sprint-recap/README.md) has the renderer flag
reference, the state file layout and a manual smoke test.
