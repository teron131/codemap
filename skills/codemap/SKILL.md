---
name: codemap
description: Navigate and scope Python and TypeScript/JavaScript repositories, including frontend source, with compact Codebase Memory, current-tree, rg, and ast-grep evidence. Use when Codex needs repository orientation, path/name/concept discovery, graph or semantic search, call-site or structural matches, focused target inspection, refactor-signal triage, or backend freshness and change-impact diagnostics.
---

# Codemap

Use Codemap to navigate and scope Python or TypeScript/JavaScript changes. Prefer compact readable output for agent work; use normalized JSON only on stable row surfaces such as `signals`, `search calls`, `search match`, and `search rule`.

Graph-backed commands serialize by project root, clear the matching operational cache entry, index once with `persistence: false`, and reuse that snapshot within the operation. Codemap does not write persistent graph data into the inspected repository. Local `rg`, ast-grep, and current-tree evidence remain independently verifiable fallbacks.

## Orient Before Substantial Work

```sh
codemap summary --project-root <path>
```

Use `summary` to find repository inventory, likely entrypoints, hubs, backend hotspots, and clusters. Continue with `search` to find a target, `inspect` to expand one known target, and `signals` to choose refactor pressure.

## Find Source From A Clue

```sh
codemap search --project-root <path> "<words>"
codemap search --graph --project-root <path> "<concept>"
codemap search --semantic --project-root <path> "<concept>"
```

Use default search for paths, exact names, and ordinary concepts. Path-shaped queries resolve from the current tree without indexing; other queries use backend-ranked matches and fall back to local ast-grep plus fixed-string, case-insensitive `rg`.

Use `--graph` when the result needs BM25-ranked relationship context. Add graph filters only in this lane:

```sh
codemap search --graph --relationship <type> --file-pattern "<glob>" --limit <count> --project-root <path> "<concept>"
```

Use `--semantic` when repository vocabulary differs from the clue. Do not combine `--graph` and `--semantic`. Unknown, empty, filtered, or error backend payloads fall back instead of suppressing current-tree evidence.

Default search does not evaluate regular expressions. Use raw `rg` for regex completeness:

```sh
rg -n "<regex>" <path>
```

## Find Call Sites Or Syntax Shapes

```sh
codemap search calls --project-root <path> <function-or-method> [paths...]
codemap search calls --json --limit <count> --project-root <path> <function-or-method> [paths...]
codemap search match --json --project-root <path> --lang <lang> --pattern "<pattern>" [paths...]
codemap search rule --json --project-root <path> --rule <rule.yml> [paths...]
```

Use `search calls` only for source call-shaped matches such as `print(...)`, `logger.info(...)`, or `console.log(...)`; backend availability never changes it into a caller/callee trace. The default cap is twenty. JSON returns compact `{total,matches}` data so truncation remains visible.

Use `search match` for one structural pattern and `search rule` for a reusable YAML rule. Built-in matching covers JavaScript and TypeScript. Use raw ast-grep for rewrite previews, fixes, complex Python rules, interactive authoring, detailed parse dumps, or engine options Codemap does not expose.

## Inspect One Known Target

```sh
codemap inspect --project-root <path> <path-or-symbol>
codemap inspect --local --project-root <path> <path-or-symbol>
codemap inspect --backend --project-root <path> <symbol>
```

Use `inspect` after search identifies one likely target. Prefer a file or directory when a short symbol may be ambiguous. Paths use current-tree evidence. Unambiguous symbols use a fresh backend snippet and call trace; ambiguous or unavailable backend matches fall back locally. Use `--local` for current-tree-only detail and `--backend` when backend resolution itself is under inspection.

## Choose Refactor Work

```sh
codemap signals --project-root <path>
codemap signals --json --project-root <path> | jq '{functionPressure, smallFunctions, longNames}'
```

Start with the default. Codemap filters and ranks before keeping up to twenty rows in each nonempty bucket; the cap prevents overflow rather than creating a tiny sample.

- `functionPressure`: inspect control flow, size, and repeated traversal together. Do not treat one metric as proof that extraction is needed.
- `smallFunctions`: verify callers, exports, framework hooks, and tests before deleting or inlining a small private function.
- `longNames`: inspect vocabulary or mixed responsibility. Do not rename solely because a name crosses the threshold.

Interpret compact fields directly:

- `cognitive`: upstream understandability pressure raised by nesting and branching.
- `cyclomatic`: upstream approximation of independent control-flow paths.
- `lines`: physical source lines spanned by the function.
- `linearScanInLoop` in JSON, rendered as `linear_scan_in_loop` in text: upstream scan sites detected inside loops, not runtime iterations or proof of a large collection.
- `mentions`: lexical identifier occurrences, not graph edges or compiler references.

Upstream metrics remain provider facts. Codemap's composite pressure score affects ordering only and is not printed. Fresh `functionPressure` uses backend rows; partial results fill remaining capacity with distinct local rows; degraded results use local rows. `smallFunctions` and `longNames` always come from the current tree.

Open a detailed lane only when the default points there:

```sh
codemap signals --project-root <path> <section>
```

- `relationships`: broader import and call relationships.
- `files` or `lengths`: density and size pressure.
- `functions`, `variables`, or `usage`: definition and lexical-usage tables.
- `docstring-signals` or `docstrings`: documentation pressure or full docstring rows.
- `all`: every section only when a broad audit justifies the larger output.

Detailed row surfaces are capped at fifty and filter generated or bundled paths where source-specific. Add `--include-tests` only when tests are the target. Text and JSON expose the same normalized facts; compact JSON is intended for `jq` and pipelines.

## Work In Python

Treat extracted relative and absolute imports, functions, classes, file containment, same-file call-like edges, and docstring/comment signals as syntax-level leads rather than compiler facts. Start from likely entries such as `__main__.py`, `cli.py`, `main.py`, and `app.py`.

Codemap's built-in ast-grep language set does not include Python. A simple Python pattern requires the ast-grep CLI:

```sh
codemap search match --project-root <path> --lang python --pattern "def $NAME($$$ARGS): $$$BODY" [paths...]
```

Python `search calls` uses the CLI when installed and otherwise labels approximate rows `[regex]`; comments and strings can match, so verify them in source. Use raw ast-grep for Python kind, relational, reusable, rewrite, or fix rules.

## Diagnose Freshness Or Change Impact

```sh
codemap index --project-root <path>
codemap backend status --project-root <path>
codemap backend schema --project-root <path>
codemap backend projects --project-root <path>
codemap backend changes --since <ref> --depth <count> --project-root <path>
codemap backend query --json --max-rows <count> --project-root <path> "<read-only Cypher>"
```

Use `index` to measure explicit refresh timing, `status` or `schema` to diagnose backend readiness, `changes` for backend changed-code impact, and raw `query --json` only as an escape hatch. Short-lived MCP children start outside the target repository so upstream watching cannot race the explicit lifecycle. A partial index may retain useful backend evidence; a missing backend degrades to current-tree evidence where a local answer exists.

## Boundaries

Treat Codemap output as syntax-level facts and indexed relationship leads, not compiler-grade reachability, complete call graphs, framework semantics, dataflow proof, or proof that a symbol is dead. Verify consequential conclusions with focused reads, `rg`, ast-grep, and repository tests.
