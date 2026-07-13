# Codemap

Codemap is an opinionated, token-conscious wrapper around Codebase Memory MCP, `rg`, and ast-grep for Python and TypeScript/JavaScript codebases. Codebase Memory supplies indexed graph intelligence, `rg` remains the exact-text baseline, and ast-grep owns built-in JavaScript/TypeScript structural search.

Codemap does not own a persistent graph store or rely on Codebase Memory's session auto-indexing. Every Codemap graph-backed operation serializes access to this root, clears its matching operational Codebase Memory cache entry when present, indexes once with `persistence: false`, reuses that clean snapshot for all backend queries in the operation, and falls back to current-tree evidence where a local answer exists.

## Product Contract

- Default text is the main agent-facing representation: compact, ranked, and evidence-only.
- Stable row surfaces (`signals`, structural matches, and call matches) offer compact normalized JSON for `jq`; composed orientation and inspection stay text-only instead of maintaining a second noisy contract. Raw backend JSON is reserved for `backend query --json` and `backend changes --json`.
- `signals` selects evidence that implies what deserves review without printing advice or prompts.
- `search calls` never changes into a backend caller/callee trace; every row names its source matching engine.
- Backend failures and unknown payloads fail closed so local fallbacks are not suppressed.

## Install

```sh
pnpm install
pnpm run build
npm install -g .
```

## Core Commands

| Command | Primary evidence | Purpose |
| --- | --- | --- |
| `summary` | Codebase Memory architecture, then current-tree fallback | Compact repository orientation. |
| `search <text>` | Current-tree paths, then Codebase Memory ranked search, then ast-grep plus `rg` fallback | Broad path, concept, symbol, and text discovery. |
| `search --graph <text>` | Codebase Memory graph search, then current-tree graph fallback | Relationship-aware discovery. |
| `search --semantic <text>` | Codebase Memory semantic graph search, then current-tree fallback | Vocabulary-bridging discovery. |
| `search calls <name>` | ast-grep, or labeled Python regex fallback | Call-shaped source matches, capped at 20 by default. |
| `search match` / `search rule` | ast-grep | Built-in JS/TS structural discovery; simple Python patterns require the ast-grep CLI. |
| `inspect <target>` | Codebase Memory for symbols, current tree for paths and fallback | Focused in-to-out neighborhood inspection. |
| `signals` | Codebase Memory function metrics plus current-tree definitions | Up to twenty useful rows in each nonempty default evidence bucket. |
| `backend ...` | Raw Codebase Memory diagnostics | Projects, status, schema, Cypher queries, and change impact. |
| `index` | Codebase Memory indexing | Explicit refresh timing and status. |

## Refactor Signals

Readable output is the default:

```sh
codemap signals --project-root <path>
```

The compact JSON surface contains the same facts:

```sh
codemap signals --json --project-root <path> | jq '{functionPressure, smallFunctions, longNames}'
```

The three default buckets are deliberately factual:

- `functionPressure`: cognitive complexity, cyclomatic complexity, source lines, and concrete linear scans inside loops when the backend reports them.
- `smallFunctions`: private functions no longer than eight lines with few lexical mentions.
- `longNames`: camelCase or snake_case variable-like identifiers at least thirty characters long with lexical mention counts; conventional constants and PascalCase owners are excluded.

Each bucket is capped at twenty rows only to prevent overflow; filters and ranking remove noise before that cap is applied. Detailed sections retain their broader fifty-row views.

Function-pressure fields use compact standard names: `cognitive` is a unitless control-flow understandability score that rises with nesting and branching; `cyclomatic` approximates independent control-flow paths; `lines` is the physical function span; and JSON's `linearScanInLoop` (rendered as `linear_scan_in_loop` in readable text) counts detected scan sites such as `find`, `filter`, or `some` inside loops. Higher values are stronger review pressure, not correctness failures. A scan site may operate on a bounded collection, so it is not proof of a performance problem.

Lexical mentions are not graph references and are labeled accordingly. The rows are review leads, not deletion or rename instructions.

Detailed sections remain explicit for narrower investigations: `relationships`, `files`, `lengths`, `functions`, `variables`, `usage`, `docstring-signals`, and `docstrings`.

## Backend Boundary

`src/codemap/codebase-memory` owns MCP transport, manual clean-index lifecycle, cross-process root serialization, generic tool-result validation, and reusable diagnostic/query operations. Its short-lived MCP children start outside the target repository so upstream session auto-indexing and watching do not race the explicit lifecycle. Search, inspect, signals, summary, and backend commands own their provider arguments, payload projection, fallback eligibility, and presentation policy.

The implementation journey, settled constraints, and evidence required for future enhancements are recorded in [`docs/IDEAS.md`](docs/IDEAS.md).

## Limits

Codemap provides syntax-level and indexed relationship evidence, not compiler-grade reachability, framework-complete data flow, or proof that a symbol is dead. Verify consequential findings with focused reads, exact search, and the repository’s tests.
