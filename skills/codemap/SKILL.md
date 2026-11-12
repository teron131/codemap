---
name: codemap
description: Navigate and scope Python and TypeScript code using Codebase Memory for graph and semantic evidence, rg for working-tree exact text, and ast-grep for syntax patterns. Use for repository orientation, path/name/concept discovery, graph or semantic search, call-site or structural matches, focused target inspection, source-metric ranking, or backend freshness and change-impact diagnostics.
---

# Codemap

Use this workflow only for Python and TypeScript code, including within mixed-language repositories; use `rg`, focused reads, and language-native tools for other languages.

Route relationship and semantic questions to Codebase Memory, exact text to `rg`, and syntax patterns to ast-grep. Read compact text by default; use JSON only on the stable row surfaces `signals`, `search calls`, `search match`, and `search rule`. Every command caps its output at about 10,000 tokens: text reports truncation inline, and JSON stays valid for `jq` and reports truncation on stderr.

Graph-backed commands refresh one non-persistent snapshot per operation and write nothing into the inspected repository. An explicit `CBM_CACHE_DIR` wins, and an unwritable default cache falls back to a private temporary one. Evidence is rebuilt on every command, so rerun it after editing source, TypeScript configuration, or package exports.

## Read The Output

Output is designed as context, so read its form as well as its rows.

- A heading states what the section selected and its row fields' order, as in `## Most Called — symbol · location · share of all calls`. A ranked list follows exactly those criteria and judges nothing.
- A selected view is not an inventory: `Structural Signals` shows at most one boundary per role, `Most Called` drops generic names such as `get` or `map`, and `Public API` shows only the surfaces its heading selects.
- Rows name their source: `ast-grep`, `regex`, or `rg` on working-tree rows, `[file]` for a path match, and a `Codebase Memory ... matches:` block for backend rows.
- Status lines say what the evidence does not cover: `backend: unavailable`, `backend: partial index`, or `backend: skipped`; `coverage: bounded working tree; parsed=N, eligible=N`; `Fallback: ...`; and `hidden tests: N`.
- `- ...`, `... N more candidates`, and `... output truncated: shown=N, total=N, ...` mean more rows exist. Working-tree search rows stop at `--limit` without a marker, so raise the limit before concluding nothing else matches.

## Orient Before Substantial Work

```sh
codemap summary --project-root <path>
```

`summary` covers README purpose, language mix, structural signals, most-called symbols, clusters, and the public API. Skip it if the session hook already provided it for this working tree. Then `search` finds a target, `inspect` expands one, and `signals` compares ranked metrics.

## Find Source From A Clue

```sh
codemap search --project-root <path> "<words>"
codemap search --graph --project-root <path> "<concept>"
codemap search --semantic --project-root <path> "<concept>"
```

Default search handles paths, exact names, and ordinary concepts. Paths, exact definitions, and decisive multi-word source matches resolve from the working tree: up to three exact text matches, or every meaningful term within one 50-line window with two on one line, in at most three files or one whose path matches. Other queries go to backend code search and fall back to ast-grep plus fixed-string, case-insensitive `rg`. Likely test rows are omitted unless `--include-tests` is set.

When the local fallback has no whole-query match, it keeps only the files covering the most query terms: at most eight multi-term or two single-term files, with an omitted count and at most two anchors each. Within that tier, path usefulness ranks first, then how tightly the terms cluster. `Collection bound reached; ranking uses the available prefix.` means only part of a very large candidate set was ranked. Documentation, configuration, and generated-only hits appear only when no source file matches.

Use `--graph` for BM25-ranked relationship context; graph filters apply only in this lane:

```sh
codemap search --graph --relationship <type> --file-pattern "<glob>" --limit <count> --project-root <path> "<concept>"
```

Use `--semantic` when the repository's vocabulary differs from the clue, never together with `--graph`. An exact working-tree definition answers before semantic ranking, and broader working-tree evidence covers an empty backend answer.

These three lanes show 15 matches by default; change that with `--limit <count>`. Default search takes no regular expressions, so use raw `rg` when regex completeness matters:

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

`search calls` finds call-shaped matches such as `print(...)`, `logger.info(...)`, or `console.log(...)`: a bare method name matches any receiver, and a dotted target is exact. It stays syntax matching even when the backend is available, so it never traces callers. JSON is compact `{total,matches}`, and at most 1,000 matches are selected unless `--limit` says otherwise.

Scope `[paths...]` to known files or directories. Without `--lang`, calls and patterns infer languages from those targets; YAML rules declare their own. Single-quote patterns containing `$NAME` or `$$$ARGS` so the shell passes them literally.

`search match` takes one pattern, and its JSON is an array of rows; `search rule` takes a reusable YAML rule, and its JSON wraps matches with rule metadata. Both cover JavaScript, TypeScript, and Python. Use raw ast-grep for rewrites, fixes, interactive authoring, parse dumps, or engine options Codemap does not expose.

## Inspect One Known Target

```sh
codemap inspect --project-root <path> <path-or-symbol>
codemap inspect --local --project-root <path> <path-or-symbol>
codemap inspect --backend --project-root <path> <symbol>
```

Use `inspect` once search has found one likely target, and prefer a path when a short symbol may be ambiguous. Paths use working-tree evidence; unambiguous symbols use a fresh backend snippet and call trace, and ambiguous or missing backend matches fall back locally. `--local` forces working-tree detail, `--backend` isolates backend resolution, and `--limit <count>` bounds each section, 1,000 rows by default.

Function inspection leaves out the owning file's function inventory; inspect the file or the class for it. Local inspection may still build repository-wide relationships, so for a call-site or syntax lookup in a large tree use `search calls` or `search match` with explicit paths.

TypeScript/JavaScript import edges resolve through the importing file's tsconfig, including inherited and nested aliases, and package `import` and `require` conditions; only targets inside the inspected source become edges. Before concluding a relationship is missing, check the import, the configuration, and whether the target is eligible.

## Compare Source Metrics

```sh
codemap signals --project-root <path>
codemap signals --json --project-root <path> | jq '{stats, functionMetrics, functionsByMentions, variablesByNameLength}'
```

Start with the default. Rankings have no per-section caps, so text is cut in reading order and on larger repositories can end inside `Function Metrics`; JSON truncation keeps the head of every ranking, so use the `jq` form to compare all three. Working-tree statistics come first: `count`, `mean`, sample `std`, percentiles to `p90`, extrema, and data-sized `bins` over every measured function and variable. Backend rows do not feed them.

- `functionMetrics`: backend rows by cognitive complexity, then cyclomatic complexity, then length; working-tree rows by length, then fewest mentions.
- `functionsByMentions`: every function definition by fewest mentions, then shortest.
- `variablesByNameLength`: every variable by longest name, then fewest mentions.

Fields:

- `cognitive`: cognitive complexity, raised by nesting and branching.
- `cyclomatic`: cyclomatic complexity, roughly the number of independent paths.
- `lines`: source lines the function spans.
- `hidden_quadratic` (`hiddenQuadratic` in JSON): searches such as `indexOf` or `includes` inside loops, a lead toward quadratic time rather than proof of it.
- `name_length` (`nameLength` in JSON): characters in a variable's name.
- `mentions`: lexical occurrences of the name, not graph edges or compiler references.

Backend values pass through unchanged. `functionMetrics` holds at most 100 backend rows, alone when the index is fresh and 100 remain after source filtering; otherwise every distinct working-tree row follows them, and with no backend only working-tree rows remain. Its heading names which mix you got. Mention and name-length rankings always come from the working tree. Rankings order rows; they do not prescribe refactors.

Above 5,000 files, signals parse only the 100 largest eligible files and report parsed versus eligible counts; treat those rows as a bounded sample with incomplete relationship and mention coverage. Above 10,000 eligible files, they skip backend metrics.

For a specific question, request one section:

```sh
codemap signals --project-root <path> <section>
```

- `relationships`: import and call relationships.
- `files` or `lengths`: density and size.
- `functions`, `variables`, or `usage`: definition and lexical-usage tables.
- `docstring-signals` or `docstrings`: documentation coverage or full docstring rows.
- `all`: every detailed section, documentation coverage, and backend function metrics, without the `top` projection; full docstrings still need `docstrings`.

A focused section skips unrelated analysis, and only `top` and `all` query the backend. Detailed sections drop generated and bundled paths and share the same output cap. Add `--include-tests` only when tests are the target. Text and JSON carry the same facts.

## Work In Python

Treat extracted imports, functions, classes, containment, same-file call edges, and docstrings as syntax-level leads, not compiler facts. Start from likely entries such as `__main__.py`, `cli.py`, `main.py`, and `app.py`.

Python parsing uses Codemap's bundled ast-grep parser, so calls in comments or strings never become edges; dynamic dispatch still needs source verification. To locate definitions:

```sh
codemap search match --project-root <path> --lang python --pattern 'def $NAME($$$ARGS): $$$BODY' [paths...]
```

## Diagnose Freshness Or Change Impact

```sh
codemap index --project-root <path>
codemap backend status --project-root <path>
codemap backend schema --project-root <path>
codemap backend projects --project-root <path>
codemap backend changes --since <ref> --depth <count> --project-root <path>
codemap backend query --json --max-rows <count> --project-root <path> "<read-only Cypher>"
```

`index` measures refresh timing, `status` and `schema` diagnose backend readiness, `changes` reports changed-code impact, and raw `query --json` is the escape hatch. A partial index may still help; an unavailable backend degrades to working-tree evidence where a local answer exists.

## Boundaries

Codemap output is syntax-level facts and indexed relationship leads, not compiler-grade reachability, complete call graphs, framework semantics, dataflow proof, or proof that a symbol is dead. Verify consequential conclusions with focused reads, `rg`, ast-grep, and the repository's tests.
