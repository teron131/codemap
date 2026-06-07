# Artifacts Reference

Use artifacts for explicit saved outputs. Do not treat them as the default operating mode for Codemap.

## Commands

```sh
codemap artifacts create --project-root <path>
codemap artifacts update --project-root <path>
codemap artifacts status --project-root <path>
codemap artifacts view --project-root <path> summary
codemap artifacts view --project-root <path> html
```

Artifacts write `.context-graph/canonical/` and `.context-graph/views/`. The rendered views include architecture, metrics, update, overview, summary, brief, hotspots, and HTML output.

## Use Artifacts Create

Use `artifacts create` when the user asks to save a report, capture a point-in-time repo map, generate handoff artifacts, produce HTML/JSON/Markdown views, or prepare CI-style evidence.

## Use Artifacts Update

Use `artifacts update` only when artifacts already exist. If no artifacts exist, create them explicitly with `artifacts create` after confirming the user wants saved artifacts.

Artifact update patches changed files, deleted files, and one-hop import dependents for structural changes. It also patches direct content-changed file nodes so document/config summaries do not stay stale.

## Use Artifacts View

Use `artifacts view` to read saved artifacts:

- `summary`, `brief`, `hotspots`: Markdown output.
- `architecture`, `metrics`, `update`, `overview`: JSON output.
- `html`: print the saved HTML report path.

Use `--pretty` for JSON views when humans will read them.

`architecture.json` includes layers, inventory, relationship counts, intent clues, and `likelyEntries` for orientation. It does not include a separate tour view.

## Semantic Boundary

Semantic indexes live under `.context-graph/semantic/`, but they are search indexes, not artifact reports. They are created with `semantic init`, then read by `search --semantic`.

```sh
codemap semantic init --project-root <path>
codemap semantic status --project-root <path>
codemap search --semantic --project-root <path> "<words>"
```

`search --semantic` reads `.context-graph/semantic/index.json` and embeds only the query. Semantic code lives under `codemap.search.semantic` and owns embeddings, card text, index IO, and scoring. It does not build repo embeddings live. If the index is missing, run `semantic init` first.
