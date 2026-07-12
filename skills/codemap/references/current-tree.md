# Current Tree Reference

Use Codemap for orientation, focused inspection, and compact refactor evidence over the files that exist now. Codemap does not write its own graph or semantic-index storage.

## Orient

```sh
codemap summary --project-root <path>
```

Use `summary` for indexed counts, hotspots, and clusters. When the backend has no recognized answer, the current-tree fallback shows inventory, likely entries, and import counts. Treat either view as orientation and verify important paths with search and reads.

## Inspect One Target

```sh
codemap inspect --project-root <path> <path-or-symbol>
```

Inspect expands outward from one known file, directory, function, class, variable, or symbol. Prefer file and directory targets when a short symbol name may resolve to several definitions.

Path inspection is current-tree first. An unambiguous symbol uses a fresh Codebase Memory snippet and trace without appending a duplicate local report. Ambiguous or unavailable backend matches fall back to current-tree inspection; `--local` selects that lane explicitly.

## Choose Refactor Targets

```sh
codemap signals --project-root <path>
codemap signals --json --project-root <path> | jq '{functionPressure, smallFunctions, longNames}'
```

The default result is bounded to four rows per bucket:

- `functionPressure`: Codebase Memory cognitive/cyclomatic complexity and concrete linear scans inside loops.
- `smallFunctions`: private functions up to eight lines with few lexical mentions.
- `longNames`: camelCase or snake_case variable-like identifiers at least thirty characters long with lexical mention counts; ALL_CAPS and PascalCase owners are excluded.

Function-pressure vocabulary:

- `cognitive`: a unitless understandability score that increases with nested and branching control flow. It is meaningful for relative ranking within the same analyzer, not as a universal grade.
- `cyclomatic`: an approximation of independent control-flow paths and therefore branch combinations.
- `lines`: the physical source span of the function.
- `linear_scan_in_loop`: detected scan operations inside loops. The number counts scan sites, not runtime iterations, and does not prove that the scanned collection is large.

Text and JSON expose the same normalized facts. Text uses one line per target; JSON is compact rather than pretty-printed because it is intended for `jq` and agent pipelines.

The output contains no instructions such as “delete” or “rename.” Selection and ordering are the opinionated layer; the caller verifies the implied change with search, source inspection, and tests.

Lexical mentions count identifier tokens across current source. They are not graph edges, compiler references, or proof that a definition is live or dead.

## Detailed Signal Sections

Request a detailed section only when the compact result points there:

```sh
codemap signals --project-root <path> relationships
codemap signals --project-root <path> functions
codemap signals --project-root <path> variables
codemap signals --project-root <path> files
codemap signals --project-root <path> lengths
codemap signals --project-root <path> docstring-signals
```

Detailed rows are capped, exclude likely tests by default, and filter generated or bundled paths where the section is source-specific. Add `--include-tests` only when tests are the target.

## Backend Boundary

Graph-backed commands delete the requested root's prior operational cache entry, call `index_repository` once with `persistence: false`, then query that snapshot. An index with skipped files is marked partial; a missing backend is degraded. Current-tree fallbacks remain available where a local answer exists.

## Non-Goals

Codemap does not provide compiler-grade reachability, complete call graphs, framework-specific magic, or dataflow proof. It produces high-signal leads that must be verified before consequential edits.
