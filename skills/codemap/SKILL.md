---
name: codemap
description: Use when Codex needs current-tree source navigation in a local codebase: repo orientation, code search, focused file/symbol inspection, refactor signals, ast-grep structural search, syntax rewrites, semantic indexed search, or explicit saved handoff artifacts.
---

# Codemap

Codemap is the current-tree source navigation and refactor-scoping tool. Use it to decide what to read next, locate code, inspect one target's neighborhood, gather refactor evidence, run guarded ast-grep operations, and create saved handoff output only when explicitly useful. Graph payloads and saved views are supporting evidence, not the primary interface.

## Use Cases

### Orient In An Unknown Repo

Start with a compact source overview:

```sh
codemap summary --project-root <path>
```

Use this when you need the repo shape before choosing files. It gives likely entries, repo intent clues, major folders, relationship hubs, and source-shape warnings. Treat the startup/session summary as orientation only; for substantial work, continue with `search`, `inspect`, `signals`, and focused reads.

### Find A Concept, Symbol, Or File

Use default search first:

```sh
codemap search --project-root <path> "<words>"
```

Default search is the **any -> in** path: start with any clue from the user, README, error text, symbol name, or phrase, then find where it lands in the codebase. It combines Codemap's shared ast-grep layer for identifier-like structural matches with fixed-string `rg` for words, phrases, filenames, and text. When the query clearly names a file or symbol, search also adds a focused target card with relationship evidence.

### Inspect One Known Target

Use inspect after summary, signals, or search gives you a file, directory, function, class, variable, or symbol:

```sh
codemap inspect --project-root <path> <path-or-symbol>
```

Inspect is the **in -> out** path: start from one known target, then expand outward to its relationship neighborhood. It shows target-specific profiles: directory summaries, file profiles, function/class profiles, variable definitions, imports, importers, contained symbols, calls, long functions, source metrics, and local pressure hints. Prefer file or directory targets first when a symbol may be ambiguous.

### Choose Refactor Targets

Use signals for neutral evidence, not automatic lint findings:

```sh
codemap signals --project-root <path> top
codemap signals --json --project-root <path> top | jq '.top.functions.longFunctions[:10]'
```

Text output is quick triage. `signals --json` is the deeper durable surface for `jq`, scripts, and agent pipelines. Use signals to notice long functions with references, least-used definitions, broad name pools, dense files, relationship hubs, and files that deserve `inspect`. Broad name pools are naming-pressure evidence, not an automatic rename queue. Signals help choose what to read or change next; they are not lint findings.

### Find Structural Patterns

Use search wrappers for read-only structural discovery when the target is a call site, ast-grep pattern, or project-specific YAML rule:

```sh
codemap search calls --project-root <path> <function-or-method> [paths...]
codemap search match --project-root <path> --lang <lang> --pattern "<pattern>" [paths...]
codemap search rule --project-root <path> --rule <rule.yml> [paths...]
```

`search calls` finds call sites: invocations like `print(...)`, `logger.info(...)`, or `console.log(...)`. It is the read-only sibling of `syntax replace-call`.

### Preview Or Apply Syntax Edits

Use syntax when the task is an AST operation, rewrite preview, debug flow, or guarded source edit:

```sh
codemap syntax replace-call --project-root <path> <old-call> <new-call> [paths...]
codemap syntax replace --project-root <path> --lang <lang> --pattern "<pattern>" --rewrite "<rewrite>" [paths...]
codemap syntax rename --project-root <path> <old-name> <new-name> [paths...]
codemap syntax debug --project-root <path> --lang <lang> --pattern "<pattern>"
```

Use `search rule --rule <rule.yml>` for read-only rule matches. Use `syntax rule --rule <rule.yml> --apply --yes` only for YAML rules with safe fixes. Codemap runs YAML rules through its shared ast-grep layer; it does not manage ast-grep rule projects.

### Search A Saved Semantic Index

Use semantic search only after an explicit index exists:

```sh
codemap semantic init --project-root <path>
codemap search --semantic --project-root <path> "<words>"
```

Semantic search is for fuzzy concept matching over saved cards. It is not source scanning, graph building, or ambient indexing.

### Create Saved Handoff Output

Normal `summary`, `search`, `inspect`, and `signals` read current files and do not write `.context-graph`. Use artifacts only when the user asks for saved artifacts, point-in-time output, CI evidence, or handoff output:

```sh
codemap artifacts create --project-root <path>
codemap artifacts view --project-root <path> summary
```

## Reference Routing

Read only the reference needed for the task:

- `references/current-tree.md`: summary, search, inspect, likely-entry target cards, signals, relationship context, and artifact-free current-code workflows.
- `references/search.md`: default source search, relationship-context search, regex, semantic search, ast-grep patterns, and syntax handoff.
- `references/syntax.md`: ast-grep pattern workflow, YAML rules, rewrite previews, and syntax codemods.
- `references/python.md`: Python import, symbol, docstring, entrypoint, and package-map behavior.
- `references/artifacts.md`: explicit saved `.context-graph` artifacts, artifact update, artifact view, and semantic index boundary.

## Boundaries

Codemap gives syntax-level source facts and relationship leads, not compiler-grade facts. Do not expect type inference, framework-specific magic, dataflow proofs, dynamic import resolution, or complete call graphs. Verify important claims with focused reads, `rg`, ast-grep, and tests before changing code. Run raw ast-grep only for engine flags, interactive rule authoring, full debug dumps, or behavior Codemap does not expose.
