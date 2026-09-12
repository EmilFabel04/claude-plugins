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
