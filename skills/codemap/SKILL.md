---
name: codemap
description: Use when Codex needs Python or TypeScript/JavaScript repo orientation, source search, focused inspection, compact refactor signals, ast-grep structural search, or Codebase Memory graph evidence.
---

# Codemap

Codemap is the source navigation and refactor-scoping tool. It clears the matching operational cache entry and indexes Codebase Memory once before graph-backed commands, keeps repository persistence disabled, and uses `rg`, ast-grep, and current-tree scanning for exact or syntax-specific evidence.

## Orient

```sh
codemap summary --project-root <path>
```

Use `summary` for a compact architecture overview, then continue with `search`, `inspect`, and `signals` before substantial changes.

## Search

```sh
codemap search --project-root <path> "<words>"
codemap search --graph --project-root <path> "<concept>"
codemap search --semantic --project-root <path> "<concept>"
```

Default search resolves path-shaped queries from the current tree first, then asks Codebase Memory for ranked code matches and falls back to local ast-grep plus fixed-string `rg`. Use graph search for relationship context and semantic search for vocabulary mismatch.

Use structural search when the syntax itself is the target:

```sh
codemap search calls --project-root <path> <function-or-method> [paths...]
codemap search match --project-root <path> --lang <lang> --pattern "<pattern>" [paths...]
codemap search rule --project-root <path> --rule <rule.yml> [paths...]
```

`search calls` caps output at 20 by default. JavaScript/TypeScript rows are ast-grep matches. Python uses the ast-grep CLI when installed and otherwise prints an explicit `[regex]` approximation; verify regex rows against source before editing. Use raw ast-grep for rewrite previews, fixes, complex Python rules, interactive rule authoring, or engine behavior Codemap does not expose.

## Inspect

```sh
codemap inspect --project-root <path> <path-or-symbol>
```

Inspect is the in-to-out path from one known target. Paths use current-tree evidence. Unambiguous symbols use the fresh backend snippet and call trace; ambiguous or unavailable backend matches fall back locally. Use `--local` when current-tree-only detail is the goal.

## Refactor Signals

```sh
codemap signals --project-root <path>
codemap signals --json --project-root <path> | jq '{functionPressure, smallFunctions, longNames}'
```

Default signals contain evidence rather than recommendations. Each nonempty bucket is capped at twenty rows only to prevent overflow:

- `functionPressure`: backend complexity and concrete scan-in-loop metrics.
- `smallFunctions`: private functions no longer than eight lines with few lexical mentions.
- `longNames`: long camelCase or snake_case variable-like identifiers; ALL_CAPS constants and PascalCase owners are excluded.

Interpret function-pressure fields as follows:

- `cognitive`: unitless control-flow understandability score; nesting and branching raise it. Compare it within the same analyzer rather than treating it as a universal grade.
- `cyclomatic`: approximate count of independent control-flow paths; higher values imply more branch combinations.
- `lines`: physical source lines spanned by the function; size evidence, not a quality verdict.
- `linear_scan_in_loop`: number of detected scan sites such as `find`, `filter`, `some`, or equivalent traversal inside loops; this is repeated-work evidence, not a runtime iteration count or proof of a performance defect.

The selection and ordering carry Codemap’s opinion. Lexical mentions are leads rather than compiler-grade references, so verify dead-code or rename conclusions with search and focused reads.

Use explicit detailed sections only when the compact view points there: `relationships`, `files`, `lengths`, `functions`, `variables`, `usage`, `docstring-signals`, or `docstrings`.

## Backend Diagnostics

```sh
codemap memory status --project-root <path>
codemap memory schema --project-root <path>
codemap memory query --json --project-root <path> "<read-only Cypher>"
codemap index --project-root <path>
```

Backend commands clear the requested root's prior operational cache entry, then index it with `persistence: false`. `memory query --json` is the raw escape hatch; normal feature output should remain compact and normalized.

## Reference Routing

- `references/current-tree.md`: summary, inspect, compact signals, detailed signal sections, and backend boundary.
- `references/search.md`: default, graph, semantic, call-site, pattern, rule, and raw-regex search.
- `references/python.md`: Python imports, symbols, call search, inspection, and signal caveats.

## Boundaries

Codemap provides syntax-level facts and indexed relationship leads, not compiler-grade reachability, complete framework semantics, or dataflow proof. Verify consequential claims with focused reads, `rg`, ast-grep, and tests.
