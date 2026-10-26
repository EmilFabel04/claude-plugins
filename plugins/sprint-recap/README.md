# sprint-recap

Replaces Claude Code's end-of-work prose with a one-screen, box-drawn recap
card and two comprehension questions. A Stop hook blocks the turn until the
card has been rendered whenever enough files changed.

Design: `docs/superpowers/specs/2026-09-12-sprint-recap-design.md`.

## Install

```bash
claude plugin marketplace add EmilFabel04/claude-plugins   # or a path to a local clone
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
