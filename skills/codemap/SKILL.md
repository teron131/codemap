---
name: codemap
description: Navigate and scope Python and TypeScript/JavaScript repositories using Codebase Memory for graph and semantic evidence, rg for current-tree exact text, and ast-grep for syntax patterns. Use for repository orientation, path/name/concept discovery, graph or semantic search, call-site or structural matches, focused target inspection, source-metric ranking, or backend freshness and change-impact diagnostics.
---

# Codemap

Route relationship and semantic questions to Codebase Memory, exact text to `rg`, and syntax patterns to ast-grep. Prefer compact readable output for agent work; use normalized JSON only on stable row surfaces such as `signals`, `search calls`, `search match`, and `search rule`. Every command applies one final conservative 10,000-token stdout ceiling; text reports truncation inline, while JSON remains valid for `jq` and reports truncation on stderr.

Graph-backed commands explicitly refresh one non-persistent snapshot per operation and do not write graph data into the inspected repository. An explicit `CBM_CACHE_DIR` remains authoritative; an unwritable default cache falls back to a private OS temporary cache. Local `rg`, ast-grep, and current-tree evidence remain independently verifiable fallbacks.

Local target inventories, parsed source facts, and import resolution are reused only within a command. After editing source, TypeScript configuration, or package exports, rerun the affected command to inspect current evidence.

## Orient Before Substantial Work

```sh
codemap summary --project-root <path>
```

Use `summary` for a focused repository overview of README purpose, language mix, structural roles, hotspots, clusters, and the selected public API. If the session hook already provided it for the current tree, do not run it again. Continue with `search` to find a target, `inspect` to expand one known target, and `signals` to compare ranked source metrics.

## Find Source From A Clue

```sh
codemap search --project-root <path> "<words>"
codemap search --graph --project-root <path> "<concept>"
codemap search --semantic --project-root <path> "<concept>"
```

Use default search for paths, exact names, and ordinary concepts. Direct paths, exact symbol definitions, and up to three exact multi-word implementation-text matches resolve from the current tree. A multi-term clue also stays local when every meaningful term occurs in source within one 50-line window, at least two terms share a line, and the evidence produces at most three complete candidates or one uniquely path-aligned complete candidate. Path affinity ranks candidates but does not supply missing term coverage. Other queries prioritize backend code search and fall back to local ast-grep plus fixed-string, case-insensitive `rg` when the backend has no usable answer. Likely test rows are omitted across backend and local evidence unless `--include-tests` is set.

In the local fallback, a multi-term phrase with no useful whole-query implementation match prefers supported source files and keeps the strongest distinct normalized query-term coverage tier instead of printing weaker isolated hits. It retains at most eight multi-term candidates or two single-term candidates and reports the omitted count. Each deduplicated file candidate shows at most two concrete anchors; repeated engine and row-kind labels are omitted because this lane is already explicitly current-tree source evidence. Incidental documentation, configuration, and generated-only text hits do not suppress this source-oriented partial pass; Codemap retains them when no supported source candidate emerges.

Use `--graph` when the result needs BM25-ranked relationship context. Add graph filters only in this lane:

```sh
codemap search --graph --relationship <type> --file-pattern "<glob>" --limit <count> --project-root <path> "<concept>"
```

Use `--semantic` when repository vocabulary differs from the clue. Do not combine `--graph` and `--semantic`. Codemap returns an exact current-tree definition before consulting semantic ranking, and falls back to broader current-tree evidence when the backend has no useful answer.

Source, graph, and semantic search return at most 15 matches by default. Add `--limit <count>` when a different result window is useful.

Default search does not evaluate regular expressions. Use raw `rg` for regex completeness:

```sh
rg -n "<regex>" <path>
```

## Find Call Sites Or Syntax Shapes

```sh
codemap search calls --project-root <path> <function-or-method> [paths...]
codemap search calls --json --limit <count> --project-root <path> <function-or-method> [paths...]
codemap search match --json --project-root <path> --lang <lang> --pattern '<pattern>' [paths...]
codemap search rule --json --project-root <path> --rule <rule.yml> [paths...]
```

Use `search calls` only for source call-shaped matches such as `print(...)`, `logger.info(...)`, or `console.log(...)`; a bare method name matches calls on any receiver, while a dotted target remains exact. Backend availability never changes it into a caller/callee trace. JSON returns compact `{total,matches}` data. Call searches select at most 1,000 matches by default; `--limit` changes that selection before the final output ceiling applies.

Scope `[paths...]` to known files or directories to reduce work and noise. Calls and patterns infer languages from those targets when `--lang` is omitted; YAML rules supply their own language. Single-quote patterns containing `$NAME` or `$$$ARGS` so the shell passes ast-grep placeholders literally.

Use `search match` for one structural pattern and `search rule` for a reusable YAML rule. Pattern JSON is an array of match rows; rule JSON wraps matches with rule metadata. Built-in matching covers JavaScript, TypeScript, and Python. Use raw ast-grep for rewrite previews, fixes, interactive authoring, detailed parse dumps, or engine options Codemap does not expose.

## Inspect One Known Target

```sh
codemap inspect --project-root <path> <path-or-symbol>
codemap inspect --local --project-root <path> <path-or-symbol>
codemap inspect --backend --project-root <path> <symbol>
```

Use `inspect` after search identifies one likely target. Prefer a file or directory when a short symbol may be ambiguous. Paths use current-tree evidence. Unambiguous symbols use a fresh backend snippet and call trace; ambiguous or unavailable backend matches fall back locally. Use `--local` for current-tree-only detail and `--backend` when backend resolution itself is under inspection.

Local inspection can build repository-wide source relationships even for one target. For a call-site or syntax lookup in a large tree, use `search calls` or `search match` with explicit file or directory paths.

Current-tree TypeScript/JavaScript import edges use the importing file's configuration, including inherited and nested tsconfig aliases, and distinguish package `import` and `require` conditions. Only resolved targets in the inspected source inventory become edges. For a missing relationship, check the import statement, project configuration, and target eligibility before drawing a conclusion about usage.

## Compare Source Metrics

```sh
codemap signals --project-root <path>
codemap signals --json --project-root <path> | jq '{stats, functionMetrics, functionsByMentions, variablesByNameLength}'
```

Start with the default. Codemap sorts all measured rows before the shared final-output budget is applied; categories do not have separate presentation caps. Whole-population current-tree statistics precede the rankings with `count`, `mean`, sample `std`, percentiles through `p90`, extrema, and automatically sized `bins` spanning each observed population. Backend top-function rows do not contribute to those population statistics.

- `functionMetrics`: backend rows sort by cognitive complexity, cyclomatic complexity, and length; current-tree fallback rows sort by length and mentions when available.
- `functionsByMentions`: all function definitions sort by lexical mentions ascending, then length ascending.
- `variablesByNameLength`: all variable definitions sort by identifier length descending, then lexical mentions ascending.

Interpret compact fields directly:

- `cognitive`: upstream control-flow measurement raised by nesting and branching.
- `cyclomatic`: upstream approximation of independent control-flow paths.
- `lines`: physical source lines spanned by the function.
- `linearScanInLoop` in JSON, rendered as `linear_scan_in_loop` in text: upstream scan sites detected inside loops, not runtime iterations or proof of a large collection.
- `mentions`: lexical identifier occurrences, not graph edges or compiler references.

Upstream metrics remain provider facts. Fresh `functionMetrics` uses backend rows; partial results fill remaining capacity with distinct current-tree rows; degraded results use current-tree rows. Mention and name-length rankings always come from the current tree. The rows describe ordering criteria, not refactor instructions.

Above the detailed-graph threshold, the fallback scans the 100 largest eligible source files and reports parsed versus eligible file counts. Its statistics describe only parsed rows. Treat its function-length and file rows as bounded current-tree evidence; relationship and mention coverage are not complete. Above 10,000 eligible files, default signals skip backend metric enrichment; use explicit backend commands only when that graph cost is justified.

Use a detailed lane when the question is already specific or the default points there:

```sh
codemap signals --project-root <path> <section>
```

- `relationships`: broader import and call relationships.
- `files` or `lengths`: density and size measurements.
- `functions`, `variables`, or `usage`: definition and lexical-usage tables.
- `docstring-signals` or `docstrings`: documentation coverage or full docstring rows.
- `all`: the detailed metric sections and documentation coverage, plus provider function metrics, without repeating the compact `top` projection. Full docstring rows require `docstrings` separately.

Prefer the relevant section over requesting `all` and discarding most of it. Focused sections skip unrelated analysis; only `top` and `all` request backend function metrics. Use `docstrings` directly when the task needs documentation text.

Detailed row surfaces filter generated or bundled paths where source-specific and use the same final-output budget. Add `--include-tests` only when tests are the target. Text and JSON expose the same normalized facts; compact JSON is intended for `jq` and pipelines.

## Work In Python

Treat extracted relative and absolute imports, functions, classes, file containment, same-file call-like edges, and docstring/comment signals as syntax-level leads rather than compiler facts. Start from likely entries such as `__main__.py`, `cli.py`, `main.py`, and `app.py`.

Python declarations, multiline imports, assignment binders, call sites, and structural patterns use Codemap's bundled ast-grep parser. Calls in comments or string examples do not become call edges; dynamic dispatch still needs source verification.

Use a structural pattern to locate definitions:

```sh
codemap search match --project-root <path> --lang python --pattern 'def $NAME($$$ARGS): $$$BODY' [paths...]
```

Python `search calls`, `search match`, and `search rule` use structural syntax matching. Use raw ast-grep for rewrite or fix rules and engine options Codemap does not expose.

## Diagnose Freshness Or Change Impact

```sh
codemap index --project-root <path>
codemap backend status --project-root <path>
codemap backend schema --project-root <path>
codemap backend projects --project-root <path>
codemap backend changes --since <ref> --depth <count> --project-root <path>
codemap backend query --json --max-rows <count> --project-root <path> "<read-only Cypher>"
```

Use `index` to measure explicit refresh timing, `status` or `schema` to diagnose backend readiness, `changes` for backend changed-code impact, and raw `query --json` only as an escape hatch. A partial index may retain useful backend evidence; an unavailable backend degrades to current-tree evidence where a local answer exists.

## Boundaries

Treat Codemap output as syntax-level facts and indexed relationship leads, not compiler-grade reachability, complete call graphs, framework semantics, dataflow proof, or proof that a symbol is dead. Verify consequential conclusions with focused reads, `rg`, ast-grep, and repository tests.
