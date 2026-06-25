# Search Reference

Use default search as the fast source interface:

```sh
codemap search --project-root <path> "<words>"
```

Default `search` is for plain words, phrases, filenames, symbols, functions, classes, and identifiers. For identifier-like queries, Codemap first asks its shared ast-grep layer for structural symbol matches. It then fills remaining results with fixed-string, case-insensitive `rg` matches. This keeps search fast on large repos and avoids graph construction.

Search has four lanes:

- Default `search`: `codemap.search.source`, shared ast-grep plus `rg`, fast and current-tree only.
- `search match`, `search calls`, and `search rule`: `codemap.search.structural`, explicit read-only ast-grep matching.
- `search --graph`: `codemap.search.graph`, relationship evidence when imports, contains edges, or nearby summaries matter.
- `search --semantic`: Codebase Memory MCP semantic graph search when a ready backend index exists, otherwise current-tree fallback.

Default `search` does not evaluate regular expressions. For raw regex text search, use `rg` directly:

```sh
rg -n "<regex>" <path>
codemap inspect --project-root <path> <candidate-file>
```

Use relationship-context search only when the result itself needs import/contains evidence:

```sh
codemap search --graph --project-root <path> "<words>"
```

Relationship-context search builds the heavier derived evidence path and can show nearby imports, contains edges, summaries, and supporting evidence. It is slower on large repos, so default shared ast-grep plus rg search should stay first.

Use semantic search when Codebase Memory MCP has an index for the project:

```sh
codemap semantic status --project-root <path>
codemap search --semantic --project-root <path> "<words>"
```

Semantic search is a backend-backed graph branch. It is for fuzzy concept matching over Codebase Memory's persistent graph, not a Codemap-owned saved index. It is not the default search path.

Use structural search when the query is an ast-grep pattern, call target, or read-only YAML rule. Start with simple pattern arguments or call wrappers; for rewrite previews and syntax codemods, read `references/syntax.md`.

```sh
codemap search match --project-root <path> --lang python --pattern "def $NAME($$$ARGS): $$$BODY" <paths...>
codemap search match --project-root <path> --lang ts --pattern "function $NAME($$$ARGS) { $$$BODY }" <paths...>
```

Use call wrappers for the common ast-grep pattern `$TARGET($$$ARGS)`:

```sh
codemap search calls --project-root <path> print <paths...>
codemap search calls --project-root <path> console.log <paths...>
```

`calls` means call sites: invocations like `print(...)`, `logger.info(...)`, or `console.log(...)`. It infers Python, TypeScript, JavaScript, TSX, and JSX from target file suffixes. Use `--lang` only when inference is not enough. Use `syntax replace-call` only when rewriting the call target.

Use syntax recipes when a structural search or rewrite is common enough to standardize:

```sh
codemap syntax recipes --project-root <path>
codemap syntax recipe --project-root <path> python-none-comparison <paths...>
codemap syntax recipe --project-root <path> python-none-comparison <paths...> --apply --yes
```

Current recipes include conservative replacements like Python `None` comparison cleanup and search recipes for debug-print/log calls. Recipes can package simple patterns or complex ast-grep rule configs with relational rules, transforms, rewriters, and fixes.

Use `codemap search rule` for read-only project-specific ast-grep YAML rules:

```sh
codemap search rule --project-root <path> --rule <rule.yml> <paths...>
```

Run raw `ast-grep` or `sg` directly only when you need engine flags, interactive rule debugging, rule authoring workflows, full debug dumps, or behavior not exposed by Codemap.

Preview rewrites before applying:

```sh
codemap syntax replace --project-root <path> --lang python --pattern "<pattern>" --rewrite "<rewrite>" <paths...>
codemap syntax replace --project-root <path> --lang python --pattern "<pattern>" --rewrite "<rewrite>" --apply --yes <paths...>
```
