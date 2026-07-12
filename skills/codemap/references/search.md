# Search Reference

## Default Search

```sh
codemap search --project-root <path> "<words>"
```

Path-shaped queries resolve exact basenames and project paths from the current tree without indexing. Other default searches ask Codebase Memory `search_code` for graph-ranked source matches after one fresh index. If the backend is unavailable, empty, filtered out, or structurally unrecognized, Codemap falls back to local ast-grep symbol search plus fixed-string, case-insensitive `rg`.

Default search does not evaluate regular expressions. Use raw `rg` for regex completeness:

```sh
rg -n "<regex>" <path>
```

## Graph And Semantic Search

```sh
codemap search --graph --project-root <path> "<concept>"
codemap search --semantic --project-root <path> "<concept>"
```

Graph search uses Codebase Memory BM25 and relationship filters, then a current-tree graph fallback. Semantic search uses Codebase Memory embeddings and falls back to current-tree search when no above-floor semantic rows remain.

Use `codemap memory status` when backend readiness itself is the question.

## Call Sites

```sh
codemap search calls --project-root <path> <function-or-method> [paths...]
```

`search calls` always means source call-shaped matches such as `print(...)`, `logger.info(...)`, or `console.log(...)`. Backend availability does not change the result into a caller/callee trace. JavaScript/TypeScript rows come from ast-grep. Python uses the ast-grep CLI when available and otherwise labels its approximate rows `[regex]`; regex rows can still match comments or strings and need a focused source read.

The default is at most twenty rows. Use `--limit <count>` to change the bound. `--json` returns compact `{total,matches}` data so truncation remains visible.

## Structural Patterns And Rules

```sh
codemap search match --project-root <path> --lang ts --pattern "function $NAME($$$ARGS) { $$$BODY }" [paths...]
codemap search rule --project-root <path> --rule <rule.yml> [paths...]
```

Use these for built-in read-only JavaScript/TypeScript ast-grep discovery. A simple Python `search match` works only when the ast-grep CLI is installed; use raw ast-grep for complex Python rules, rewrite previews, fixes, interactive rule authoring, detailed parse dumps, or engine options Codemap does not expose.

## Search Lanes

- Default: current-tree path matches, then Codebase Memory ranked code search, then ast-grep plus `rg` fallback.
- Graph: Codebase Memory relationship search, then current-tree graph fallback.
- Semantic: Codebase Memory semantic search, then current-tree text fallback.
- Calls: ast-grep for JavaScript/TypeScript; labeled Python regex fallback when the CLI is absent.
- Match and rule: built-in JavaScript/TypeScript ast-grep; limited Python CLI handoff.

`--graph` and `--semantic` are mutually exclusive. Graph-only filters require `--graph` instead of being silently ignored.

Backend payloads are accepted only when they contain the tool-specific result fields Codemap knows how to normalize. Unknown or error payloads fall back instead of suppressing current-tree evidence.
