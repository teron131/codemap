---
name: codemap
description: Use when searching, inspecting, mapping, summarizing, saving artifacts, or orienting inside a local codebase with Codemap.
---

# Codemap

Codemap is the current-tree source navigation and refactor-scoping tool. It packages fast shared ast-grep plus rg search, relationship-context graph search, focused inspection, smart target cards, syntax-aware rewrites, signal buckets, optional semantic indexes, and explicit saved artifacts. Graph payloads are supporting evidence, not the primary interface.

## Use Cases

### You Are New To A Repo

Start with a compact source overview:

```sh
codemap summary --project-root <path>
```

Use this to find likely entrypoints, repo intent clues, major folders, and relationship hubs before reading files manually.

### You Need To Find A Concept, Symbol, Or File

Use default search first:

```sh
codemap search --project-root <path> "<words>"
```

Default search is the **any -> in** path: start with any clue from the user, README, error text, symbol name, or phrase, then find where it lands in the codebase. It combines Codemap's shared ast-grep layer for identifier-like structural matches with fixed-string `rg` for words, phrases, filenames, and text. When the query clearly names a file or symbol, search also adds a focused target card with relationship evidence. Use `search --semantic` only after an explicit `semantic init` has created a saved index.

### You Have A Target And Need Its Neighborhood

Use inspect after summary, signals, or a previous search gives you a file or symbol:

```sh
codemap inspect --project-root <path> <path-or-symbol>
```

Inspect is the **in -> out** path: start from one known file, directory, function, class, variable, or symbol inside the codebase, then expand outward to its relationship neighborhood. It shows target-specific profiles: directory profiles, file profiles, function/class profiles, variable definitions, imports, importers, contained symbols, calls, and local pressure hints.

### You Are Planning A Refactor

Use signals for neutral evidence, not automatic lint findings:

```sh
codemap signals --project-root <path> top
codemap signals --json --project-root <path> top | jq '.top.functions.longFunctions[:10]'
```

Text output is quick triage. `--json` is the durable surface for `jq`, scripts, and agent pipelines. Use signals to notice long functions with references, least-used definitions, broad name pools, dense files, relationship hubs, and files that deserve `inspect`.

### You Need Structural Search Or Syntax Operations

Use search wrappers for read-only structural discovery instead of hand-writing ast-grep patterns repeatedly:

```sh
codemap search calls --project-root <path> --lang <lang> <function-or-method> [paths...]
codemap search match --project-root <path> --lang <lang> --pattern "<pattern>" [paths...]
codemap search rule --project-root <path> --rule <rule.yml> [paths...]
```

`search calls` finds call sites: invocations like `print(...)`, `logger.info(...)`, or `console.log(...)`. It is the read-only sibling of `syntax replace-call`.

Use syntax only when the task is an AST operation, rewrite preview, debug flow, or guarded source edit:

```sh
codemap syntax replace-call --project-root <path> --lang <lang> <old-call> <new-call> [paths...]
codemap syntax replace --project-root <path> --lang <lang> --pattern "<pattern>" --rewrite "<rewrite>" [paths...]
codemap syntax debug --project-root <path> --lang <lang> --pattern "<pattern>"
```

Use `search rule --rule <rule.yml>` for read-only rule matches. Use `syntax rule --rule <rule.yml> --apply --yes` only for YAML rules with safe fixes. Codemap runs YAML rules through its shared ast-grep layer; it does not manage ast-grep rule projects.

### You Need Saved Artifacts Or Handoff Evidence

Normal `summary`, `search`, `inspect`, and `signals` read current files and do not write `.context-graph`. Use artifacts only when the user asks for saved reports, point-in-time output, CI evidence, or handoff output:

```sh
codemap artifacts create --project-root <path>
codemap artifacts view --project-root <path> summary
```

## Reference Routing

Read only the reference needed for the task:

- `references/current-tree.md`: summary, search, inspect, target cards, signals, relationship context, and artifact-free current-code workflows.
- `references/search.md`: default source search, relationship-context search, regex, semantic search, ast-grep patterns, and syntax handoff.
- `references/syntax.md`: ast-grep pattern workflow, YAML rules, rewrite previews, and syntax codemods.
- `references/python.md`: Python import, symbol, docstring, entrypoint, and package-map behavior.
- `references/artifacts.md`: saved `.context-graph` artifacts, artifact update, artifact view, and semantic index boundary.

## Boundaries

Codemap gives syntax-level source facts and relationship leads, not compiler-grade facts. Do not expect type inference, framework-specific magic, dataflow proofs, dynamic import resolution, or complete call graphs. Verify important claims with focused reads, `rg`, ast-grep, and tests before changing code. Run raw ast-grep only for engine flags, interactive rule authoring, full debug dumps, or behavior Codemap does not expose.
