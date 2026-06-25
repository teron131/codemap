# Codemap Architecture

Codemap is a Codebase Memory-backed source inspection CLI. It uses Codebase Memory MCP as the default intelligence path for graph search, semantic search, traces, snippets, architecture, and status, then uses `rg`, ast-grep, source scanning, lightweight relationship evidence, and refactor signals for local fallback and syntax-specific gaps. It does not own a persistent graph store; Codebase Memory MCP is the persistent graph backend.

## Design Intent

Codemap is an agent-facing source navigation and refactor-scoping tool. It should stay small, direct, and Codebase Memory first for high-level intelligence.

- Backend-backed commands synchronously ask Codebase Memory MCP to index the project before every query.
- Current-tree commands inspect live files and do not write Codemap-owned graph storage.
- `src/codemap/ast-grep` is the shared ast-grep boundary; `rg` stays the subprocess boundary for text search and file discovery.
- `search` is broad discovery; `inspect <target>` is the explicit path for one known file, symbol, or neighborhood.
- Codebase Memory MCP is the backend for persistent graph search, semantic graph search, snippets, traces, architecture summaries, backend-informed signals, and backend status.
- `signals` are backend-informed local refactor evidence, not lint findings.

## Install

Use `pnpm` for repo dependencies and builds, then use `npm` for the global CLI install:

```sh
pnpm install
pnpm run build
npm install -g .
```

For agent use, enable the Codemap skill in the matching agent guidance so agents know when to reach for `codemap` before broad refactor or architecture work.

## Command Surface

| Area | Commands | Reads | Writes / guard | Purpose |
| --- | --- | --- | --- | --- |
| Backend wrappers | `summary`, `search <text>`, `search --graph <text>`, `search --semantic <text>`, `inspect <symbol>`, `search calls <name>`, `memory status`, `index` | Codebase Memory MCP after synchronous indexing, with local fallback where useful | Backend index only | Discovery, focused source neighborhoods, traces, architecture, snippets, status, and explicit refresh timing. |
| Current tree | `signals [section]`, path/file `inspect <target>` | Codebase Memory status plus current tree | Backend index only for signal context | Refactor evidence and direct file or directory inspection. |
| Structural search | `search match`, `search rule`, scoped `search calls` | Current tree plus pattern, rule, language, or path input | None | Explicit read-only ast-grep matches under the search surface. |

## Runtime Model

```mermaid
sequenceDiagram
    participant CLI
    participant Backend as Codebase Memory MCP
    participant Search as ast-grep + rg
    participant Source as source evidence

    CLI->>Backend: index_repository before backend query
    Backend-->>CLI: ready project
    CLI->>Backend: search/summary/inspect/status
    alt backend answer
        Backend-->>CLI: graph results, snippets, traces, architecture
    else unavailable or no answer
        CLI->>Search: current-tree search
        Search-->>CLI: source matches
        CLI->>Source: scan, graph, signals, inspect
        Source-->>CLI: evidence, likely entries, profiles
    end
```

## Module Ownership

```mermaid
flowchart TD
    CLI["commands.cli"] --> Current["current-tree commands"]
    CLI --> Backend["codebase-memory backend"]

    subgraph CurrentLane["Current tree"]
        SearchInspect["summary / search / inspect / signals"]
        Source["source evidence"]
        Rg["rg text"]
        AstGrep["ast-grep adapter"]
        SourceParts["scanner / extraction / graph / signals / inspection"]

        SearchInspect --> Rg
        SearchInspect --> AstGrep
        SearchInspect --> Source
        Source --> SourceParts
    end

    subgraph BackendLane["Persistent backend"]
        CBM["Codebase Memory MCP"]
        GraphTools["search_graph / search_code / trace_path / get_code_snippet / get_architecture"]

        CBM --> GraphTools
    end

    Backend --> CBM
```

## Architecture Notes

- Codemap-owned persistent artifacts and separate local semantic indexes are intentionally absent.
- Source evidence lives in `src/codemap/source`: scanner, extraction, graph, signals, inspection.
- ast-grep usage is centralized in `src/codemap/ast-grep`; `rg` stays a subprocess boundary.
- Search lanes are direct code boundaries: `src/codemap/search/source`, `src/codemap/search/structural`, and `src/codemap/search/graph`.
- `src/codemap/codebase-memory` owns the persistent backend adapter, unconditional indexing trigger, semantic graph search, and renderer shortcuts.
