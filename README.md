# Codemap

Codemap is an opinionated, token-conscious wrapper around Codebase Memory MCP, `rg`, and ast-grep for Python and TypeScript/JavaScript codebases. Codebase Memory supplies indexed graph intelligence, `rg` remains the exact-text baseline, and ast-grep owns built-in JavaScript/TypeScript structural search.

## Why Codemap

Codemap combines Codebase Memory's graph intelligence, `rg` exact search, and ast-grep structural search in a smaller agent-oriented workflow.

- Routes relationship and semantic questions to Codebase Memory, exact text to `rg`, and syntax patterns to ast-grep, with current-tree fallbacks when indexed evidence is unavailable.
- Filters, ranks, deduplicates, and labels results around the next useful inspection.
- Keeps output compact and predictable instead of exposing provider payloads.
- Falls back to local evidence when Codebase Memory is unavailable, partial, or stale.
- Uses explicit non-persistent refreshes without adding graph artifacts to inspected repositories.

Use Codemap for normal repository navigation and change scoping. Use direct Codebase Memory queries when unrestricted graph exploration or provider-specific diagnostics matter more than compact defaults.

## Install

Node.js 22+ is required. The examples use npm; equivalent pnpm commands also work. For full functionality:

- [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp#installation) provides graph and semantic features through the `codebase-memory-mcp` binary.
- [ripgrep](https://github.com/BurntSushi/ripgrep#installation) provides fast exact-text search through `rg`.
- Codemap installs `@ast-grep/napi` for built-in JavaScript and TypeScript structural search. The optional [ast-grep CLI](https://github.com/ast-grep/ast-grep#installation) adds Python patterns and advanced structural operations.

Install the external tools on macOS:

```sh
brew install ripgrep ast-grep
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/scripts/setup.sh | bash
```

Build and link Codemap:

```sh
npm install
npm run build
npm install -g .
```

Verify the full setup:

```sh
codebase-memory-mcp --version
rg --version
ast-grep --version
codemap --help
```

## Core Commands

| Command | Primary evidence | Purpose |
| --- | --- | --- |
| `summary` | Codebase Memory architecture, then current-tree fallback | Compact repository orientation. |
| `search <text>` | Current-tree paths and exact definitions, then Codebase Memory ranked search, then ast-grep plus `rg` fallback | Broad path, concept, symbol, and text discovery. |
| `search --graph <text>` | Codebase Memory graph search, then current-tree graph fallback | Relationship-aware discovery. |
| `search --semantic <text>` | Codebase Memory semantic graph search, then current-tree fallback | Vocabulary-bridging discovery. |
| `search calls <name>` | ast-grep, or labeled Python regex fallback | Call-shaped source matches. |
| `search match` / `search rule` | ast-grep | Built-in JS/TS structural discovery; simple Python patterns require the ast-grep CLI. |
| `inspect <target>` | Codebase Memory for symbols, current tree for paths and fallback | Focused in-to-out neighborhood inspection. |
| `signals` | Codebase Memory function metrics plus current-tree definitions | Ranked source metrics under the shared output ceiling. |
| `backend ...` | Raw Codebase Memory diagnostics | Projects, status, schema, Cypher queries, and change impact. |
| `index` | Codebase Memory indexing | Explicit refresh timing and status. |

## Output

Codemap estimates tokens conservatively as UTF-8 bytes divided by three and limits final stdout to approximately 10,000 tokens. Text output keeps complete lines and ends with `shown`, `total`, and `truncated` counts when shortened. JSON output remains one valid minified value, keeps complete array items in breadth-first order, and writes the same counts to stderr. Explicit `--limit` and `--max-rows` options can request smaller results; the broader default fetch safeguard exists only to prevent unbounded work before final presentation.

## Limits

Codemap provides syntax-level and indexed relationship evidence, not compiler-grade reachability, framework-complete data flow, or proof that a symbol is dead. Verify consequential findings with focused reads, exact search, and the repository’s tests.

Implementation constraints and future evaluation criteria are recorded in [`docs/IDEAS.md`](docs/IDEAS.md).
