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
