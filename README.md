# Codemap

Codemap is an opinionated, token-conscious source-inspection CLI for Python and TypeScript/JavaScript. It orchestrates Codebase Memory MCP, `rg`, and ast-grep behind a compact command surface.

## Why Codemap

Codemap chooses the appropriate evidence source and shapes the results around an agent's next action.

- Keeps graph, exact-text, and structural evidence clearly labeled.
- Filters, ranks, and deduplicates results to surface the next useful inspection.
- Keeps output compact and predictable instead of exposing provider payloads.
- Falls back to local evidence when Codebase Memory is unavailable, partial, or stale.
- Refreshes graph data explicitly without adding persistent artifacts to inspected repositories.

Use Codemap for normal repository navigation and change scoping. Use direct Codebase Memory queries when unrestricted graph exploration or provider-specific diagnostics matter more than compact defaults.

## Install

Node.js 22+ is required. Commands below use npm; equivalent pnpm commands also work.

| Tool | Role | Setup |
| --- | --- | --- |
| [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp#installation) | Relationships, architecture, semantic search, and change impact | Install the external `codebase-memory-mcp` binary |
| [ripgrep](https://github.com/BurntSushi/ripgrep#installation) | Exact-text search and fast file discovery | Install the external `rg` binary |
| [ast-grep](https://github.com/ast-grep/ast-grep#installation) | Structural search and source parsing | JavaScript and TypeScript engine bundled; CLI optional for Python and advanced operations |

Install the external tools on macOS for full coverage:

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

Every command applies one final approximate 10,000-token ceiling after selection and rendering. Text keeps complete lines and reports `shown`, `total`, and `truncated` counts. JSON remains one valid minified value and reports truncation on stderr. Use `--limit` or `--max-rows` when a smaller result is preferable.

## Limits

Codemap provides syntax-level and indexed relationship evidence, not compiler-grade reachability, framework-complete data flow, or proof that a symbol is dead. Verify consequential findings with focused reads, exact search, and the repository’s tests.

Implementation constraints and future evaluation criteria are recorded in [`docs/IDEAS.md`](docs/IDEAS.md).
