# emil-plugins

A small, local-first marketplace of [Claude Code](https://claude.com/claude-code) plugins.
Everything here is plain Node with zero npm dependencies and a real test suite.

| Plugin | What it does |
|---|---|
| [sprint-recap](plugins/sprint-recap/) | Replaces Claude's end-of-work prose with a one-screen recap card and two comprehension questions, enforced by a Stop hook |

## sprint-recap

When Claude Code finishes a chunk of coding work it usually ends with a wall of
prose that is easy to skim and forget. sprint-recap makes it end with this
instead:

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

The numbers come from git, not from Claude. The card is always 70 columns
wide and at most 30 rows tall. The two questions test whether you understood
*why* the change works, not which files were edited. Claude grades your
answers on the next message and then carries on.

### How it works

1. **`UserPromptSubmit` hook** records HEAD and a `git diff --numstat`
   baseline when you send a prompt.
2. **`Stop` hook** measures what changed since that prompt. If at least
   2 files or 20 lines changed and no card has been rendered, it blocks the
   turn and tells Claude to use the skill.
3. **Skill** has Claude write structured JSON (components, decisions,
   verification results, two questions with model answers) and pipe it into
   a deterministic renderer. Claude never draws boxes or types line counts.
4. **Renderer** validates the JSON against strict field limits, measures the
   sprint from git, lays out the card, prints it, and records a history
   entry. If the JSON is invalid it exits 1 with one line naming the field.

Every hook fails open: any error is logged to
`~/.claude/sprint-recap/hook-errors.log` and the hook exits 0, so a plugin
bug can never trap a session.

Nothing is written inside your project repos. State lives in
`~/.claude/sprint-recap/`.

## Install

From GitHub:

```bash
claude plugin marketplace add EmilFabel04/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

From a local clone:

```bash
claude plugin marketplace add ~/Claude/claude-plugins
claude plugin install sprint-recap@emil-plugins
```

Restart Claude Code after installing. The skill is available as
`/sprint-recap:sprint-recap` (and `/sprint-recap` on recent versions).

To pick up changes after editing the plugin:

```bash
claude plugin marketplace update emil-plugins
claude plugin update sprint-recap
```

## Configure

Optional overrides in `~/.claude/sprint-recap/config.json`. Defaults:

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
| `maxRows` | Card height cap, content is trimmed to fit |
| `questions` | Number of comprehension questions the renderer requires |

## Develop

Requires Node 22 or newer and git.

```bash
git clone https://github.com/EmilFabel04/claude-plugins.git
cd claude-plugins
npm test                      # 96 tests, real git repos in a temp dir, ~2 s
claude plugin validate .      # manifest check
```

Tests never touch real state: they point `SPRINT_RECAP_HOME` at a temp
directory and create throwaway git repos under `os.tmpdir()`.

Repository layout:

```
.claude-plugin/marketplace.json     marketplace manifest ("emil-plugins")
docs/superpowers/specs/             design specs
docs/superpowers/plans/             implementation plans
plugins/sprint-recap/
  .claude-plugin/plugin.json
  hooks/hooks.json                  UserPromptSubmit + Stop wiring
  skills/sprint-recap/SKILL.md      when and how Claude produces a recap
  scripts/render.js                 JSON in, card out
  scripts/stamp-turn.js             UserPromptSubmit hook
  scripts/check-recap.js            Stop hook
  scripts/lib/                      config, text, validate, layout, git, measure, state
  tests/                            node --test suite and fixtures
  README.md                         plugin details, smoke test, troubleshooting
```

The plugin's [README](plugins/sprint-recap/README.md) has the full flag
reference, the state file layout, and a manual smoke test. The
[design spec](docs/superpowers/specs/2026-09-12-sprint-recap-design.md)
explains every layout and trimming rule.
