# Current Tree Reference

Use Codemap when the task is about current files: orientation, discovery, focused inspection, smart target cards, relationship context, or refactor evidence. Normal current-tree commands do not require or write `.context-graph`.

## Orient In An Unknown Repo

```sh
codemap summary --project-root <path>
```

Use `summary` to identify inventory, likely entries, import counts, layers, starting paths, source-shape warnings, and intent clues from README or likely-start file docstrings.

## Find Candidate Code

```sh
codemap search --project-root <path> "<words>"
```

Use `search` for concept, phrase, filename, function, class, or symbol discovery. Search is the **any -> in** path: start with any clue from the user, README, error text, symbol name, or phrase, then find where it lands in the codebase. It uses Codemap's shared ast-grep layer for identifier-like structural hits plus `rg` for text.

When the query clearly names a file or symbol, default search also adds a focused target card with imports, importers, contained symbols, calls, long functions, and file-profile hints.

Use `search --graph` only when the search result itself needs relationship context:

```sh
codemap search --graph --project-root <path> "<words>"
```

This heavier path can include imports, contains edges, summaries, and nearby supporting evidence. It is not the default search mode.

## Inspect One Target

```sh
codemap inspect --project-root <path> <path-or-symbol>
```

Use `inspect` after `summary`, `search`, or `signals` gives you a target. It is the explicit **in -> out** path: start from one known file, directory, function, class, variable, or symbol inside the codebase, then expand outward to its relationship neighborhood. Prefer file or directory targets first when the symbol is ambiguous.

Inspect profiles are useful before edits because they show target-specific evidence: directory summaries, file profiles, function/class profiles, variable definitions, imports, importers, contained symbols, calls, long functions, source metrics, and file-profile hints. Variable rows are source definitions and references seen by syntax scanning; verify behavior before deleting or renaming.

## Choose Refactor Targets

```sh
codemap signals --project-root <path> top
codemap signals --json --project-root <path> top | jq '.top.functions.longFunctions[:10]'
```

Use `signals` for structural refactor evidence. The default output is a compact bucket overview, then other sections expose the underlying measurements. `signals --json` is the durable contract for scripts and agent pipelines:

- `relationships`: relationship counts and hubs.
- `functions`: long functions with reference counts and broad function names.
- `variables`: least-used definitions and broad name pools.
- `files`: dense file profiles.
- `usage` and `lengths`: lower-level distributions.

Signals should help choose what to read or change next; they should not automatically decide that code is wrong. Broad function and variable name pools are naming-pressure evidence only. Dense file text rows use `signals` for the summed structural count when full analysis is available. Large-repo fallback rows use `lines` because they are scanner-only file-size hints, while JSON keeps the field name `total` for existing scripts. Rows have an internal high cap to prevent runaway output. Source-specific rows skip generated/vendor-style files, and file-specific rows skip likely tests by default; add `--include-tests` for whole-tree rows. Use `--json` with `jq` for filtering, slicing, scripts, and agent pipelines.

## Artifact Boundary

Do not run `artifacts create` or `artifacts update` for normal search, inspect, summary, or signals requests. Use artifacts only when the user asks for saved output, durable handoff evidence, CI-style evidence, or point-in-time output.

## Non-Goals

Codemap does not provide compiler-grade reachability, type inference, full call graphs, framework-specific semantics, or dataflow proofs. It gives current-tree source facts and refactor evidence that should be verified with focused reads and tests before edits.
