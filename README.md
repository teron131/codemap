# Codemap

Codemap is an opinionated, token-conscious wrapper around Codebase Memory MCP, `rg`, and ast-grep for Python and TypeScript/JavaScript codebases. Codebase Memory supplies indexed graph intelligence, `rg` remains the exact-text baseline, and ast-grep owns built-in JavaScript/TypeScript structural search.

Codemap does not own a persistent graph store or rely on Codebase Memory's session auto-indexing. Every Codemap graph-backed operation serializes access to this root, clears its matching operational Codebase Memory cache entry when present, indexes once with `persistence: false`, reuses that clean snapshot for all backend queries in the operation, and falls back to current-tree evidence where a local answer exists.

## Product Contract

- Default text is the main agent-facing representation: compact, ranked, and evidence-only.
- Stable row surfaces (`signals`, structural matches, and call matches) offer compact normalized JSON for `jq`; composed orientation and inspection stay text-only instead of maintaining a second noisy contract. Raw backend JSON is reserved for `backend query --json` and `backend changes --json`.
- Every command applies one final conservative 10,000-token stdout ceiling after selection and rendering. Text keeps complete lines and prints truncation counts; JSON stays valid and minified, with truncation counts sent to stderr so `jq` pipelines remain intact.
- `signals` ranks measured source facts without labeling the rows as problems or recommendations.
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
| `search calls <name>` | ast-grep, or labeled Python regex fallback | Call-shaped source matches. |
| `search match` / `search rule` | ast-grep | Built-in JS/TS structural discovery; simple Python patterns require the ast-grep CLI. |
| `inspect <target>` | Codebase Memory for symbols, current tree for paths and fallback | Focused in-to-out neighborhood inspection. |
| `signals` | Codebase Memory function metrics plus current-tree definitions | Ranked source metrics under the shared output ceiling. |
| `backend ...` | Raw Codebase Memory diagnostics | Projects, status, schema, Cypher queries, and change impact. |
| `index` | Codebase Memory indexing | Explicit refresh timing and status. |

## Ranked Source Metrics

Readable output is the default:

```sh
codemap signals --project-root <path>
```

The compact JSON surface contains the same facts:

```sh
codemap signals --json --project-root <path> | jq '{functionMetrics, functionsByMentions, variablesByNameLength}'
```

The three default buckets describe their ordering criteria directly:

- `functionMetrics`: backend rows ordered by cognitive complexity, cyclomatic complexity, and source length; current-tree fallback rows are ordered by length and mentions.
- `functionsByMentions`: all scanned function definitions ordered by lexical mentions ascending, then source length ascending.
- `variablesByNameLength`: all scanned variable definitions ordered by identifier length descending, then lexical mentions ascending.

Rows are sorted before the shared final-output budget is applied; there is no separate per-bucket presentation cap. Generated paths and tests are omitted by default, but the ranking does not classify a long, rarely mentioned, or verbose definition as defective.

Function metric fields use compact standard names: `cognitive` is a unitless control-flow measurement that rises with nesting and branching; `cyclomatic` approximates independent control-flow paths; `lines` is the physical function span; and JSON's `linearScanInLoop` (rendered as `linear_scan_in_loop` in readable text) counts detected scan sites such as `find`, `filter`, or `some` inside loops. These are sorting facts, not correctness findings. A scan site may operate on a bounded collection, so it is not proof of a performance problem.

Lexical mentions are not graph references and are labeled accordingly. A one-mention function may be a substantial, well-owned workflow; its position states only the measured frequency and tie-break order.

Detailed sections remain explicit for narrower investigations: `relationships`, `files`, `lengths`, `functions`, `variables`, `usage`, `docstring-signals`, and `docstrings`.

## Output Budget

Codemap estimates tokens conservatively as UTF-8 bytes divided by three and limits final stdout to approximately 10,000 tokens. Text output keeps complete lines and ends with `shown`, `total`, and `truncated` counts when shortened. JSON output remains one valid minified value, keeps complete array items in breadth-first order, and writes the same counts to stderr. Explicit `--limit` and `--max-rows` options can request smaller results; the broader default fetch safeguard exists only to prevent unbounded work before final presentation.

## Backend Boundary

`src/codemap/codebase-memory` owns MCP transport, manual clean-index lifecycle, cross-process root serialization, generic tool-result validation, and reusable diagnostic/query operations. Its short-lived MCP children start outside the target repository so upstream session auto-indexing and watching do not race the explicit lifecycle. Search, inspect, signals, summary, and backend commands own their provider arguments, payload projection, fallback eligibility, and presentation policy.

The implementation journey, settled constraints, and evidence required for future enhancements are recorded in [`docs/IDEAS.md`](docs/IDEAS.md).

## Limits

Codemap provides syntax-level and indexed relationship evidence, not compiler-grade reachability, framework-complete data flow, or proof that a symbol is dead. Verify consequential findings with focused reads, exact search, and the repository’s tests.
