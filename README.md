# Codemap

Codemap is an opinionated, token-conscious source-inspection CLI for Python and TypeScript/JavaScript. It orchestrates Codebase Memory MCP, ripgrep, and ast-grep behind a compact command surface.

![Four stacked layers over Codemap's own source, each reading more than the one below: ripgrep matches exact text, ast-grep matches syntax trees, Codebase Memory MCP links calls across files into a graph, and Codemap, on top, turns all three into summary and signals. A pink thread carries the most complex function up through every layer to the first signals row.](docs/images/codemap.svg)

## Core Commands

| Command | Primary evidence | Purpose |
| --- | --- | --- |
| `summary` | Working-tree README, manifests, imports, and exports, enriched by Codebase Memory | Orientation: README purpose and outline, language mix, structural signals, most-called symbols, clusters, and the public API. |
| `search <text>` | Working-tree paths, definitions, and decisive text matches; then Codebase Memory ranked search, with local fallback | Path, concept, symbol, and text discovery. |
| `search --graph <text>` | Codebase Memory graph search, then working-tree graph fallback | Relationship-aware discovery. |
| `search --semantic <text>` | Exact working-tree definition, then Codebase Memory semantic search and working-tree fallback | Discovery across differing vocabulary, without hiding an exact definition. |
| `search calls <name>` | ast-grep | Call-shaped source matches. |
| `search match` / `search rule` | ast-grep | Structural matches in JavaScript, TypeScript, and Python. |
| `inspect <target>` | Codebase Memory for symbols, working tree for paths and fallback | One target and its neighborhood. |
| `signals` | Codebase Memory function metrics plus working-tree definitions | Ranked source metrics. |
| `backend ...` | Raw Codebase Memory diagnostics | Projects, status, schema, Cypher queries, and change impact. |
| `index` | Codebase Memory indexing | Explicit refresh timing and status. |

## Why Codemap

Codemap is context as code: what a command prints is the context an agent reasons from, so the selection, order, names, and limits of every result are designed rather than passed through from a tool. Coding agents are its readers, and they also develop it.

![Every function in Codebase Memory as a bar as long as its cognitive complexity. signals drops the test functions, ranks the rest by cognitive complexity, then cyclomatic, then length, and cuts the ranking at a fixed budget of rows. The rows on either side of the cut are tied, but a running total beside the ranking shows the rows the agent reads already hold most of the complexity while each unread row adds a sliver. Magnified, that head is what the agent reads, under a heading that names the order. A key explains cognitive, cyclomatic, and hidden_quadratic.](docs/images/signals.svg)

Codemap picks the evidence source for each question and shapes the result around the agent's next action:

- Filters, ranks, and deduplicates, and labels every row with its source.
- Prints compact, predictable text instead of backend payloads.
- Uses terms agents already know, such as `cyclomatic`, or plain names such as `hidden_quadratic`, never backend field names.
- States what each view selected and what it bounded, substituted, omitted, or cut.
- Falls back to local evidence when Codebase Memory is unavailable, partial, or stale.
- Refreshes the graph explicitly and writes nothing into the inspected repository.

Use direct Codebase Memory queries only when unrestricted graph exploration or backend diagnostics matter more than compact defaults.

## Install

Node.js 22.12+ is required. Commands below use npm; equivalent pnpm commands also work.

| Tool | Role | Setup |
| --- | --- | --- |
| [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp#installation) | Relationships, architecture, semantic search, and change impact | Install the external `codebase-memory-mcp` binary, 0.12 or later |
| [ripgrep](https://github.com/BurntSushi/ripgrep#installation) | Exact-text search and fast file discovery | Install the external `rg` binary |
| [ast-grep](https://github.com/ast-grep/ast-grep#installation) | Structural search and source parsing | JavaScript, TypeScript, and Python engines bundled; CLI optional for advanced operations outside Codemap |

Codebase Memory runs a daemon behind a Unix socket in `/tmp/cbm-daemon-<uid>`. An agent sandbox must let commands write that directory and use its socket; otherwise graph-backed commands report `backend: unavailable` with the backend's reason and answer from the working tree.

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
codemap --version
codemap --help
```

Agents use the companion skill in [`skills/codemap/SKILL.md`](skills/codemap/SKILL.md) for when to run each command and how to read its output. Copy `skills/codemap/` into the agent's skills directory, and again whenever it changes.

## Output

The form of a result is part of its content. A heading names what was selected and its row fields' order, as in `## Most Called — symbol · location · share of all calls`. Rows carry their evidence source: `ast-grep`, `regex`, or `rg` for the working tree, and a `Codebase Memory ... matches:` block for the backend. Lines starting `backend:`, `coverage:`, `Fallback:`, or `hidden tests:` say what the evidence does not cover, and a closing `- ...` says more rows exist.

Every command caps its final output at about 10,000 tokens. Text keeps whole lines and reports `shown`, `total`, and `truncated` counts; JSON stays one valid value that keeps the head of every list and reports truncation on stderr. Search shows 15 matches by default; change that with `--limit`, or `--max-rows` on backend queries.

## Limits

Codemap provides syntax-level and indexed relationship evidence, not compiler-grade reachability, framework-complete data flow, or proof that a symbol is dead. Verify consequential findings with focused reads, exact search, and the repository’s tests.

Design decisions and evaluation criteria live in [`docs/IDEAS.md`](docs/IDEAS.md).
