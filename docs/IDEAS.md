# Codemap Ideas

This document records how Codemap's current design emerged and what evidence should guide future enhancements. It is neither a release history nor a committed roadmap; the README remains the user-facing contract.

## Journey So Far

Codemap began as a compact, opinionated layer over `rg` and ast-grep. Those tools established the baseline: exact text and syntax-aware matches should remain fast, current-tree-first, and independently verifiable.

Codebase Memory later became the primary source for repository structure, symbol neighborhoods, semantic search, change impact, and function metrics. Codemap kept ownership of selection and presentation instead of exposing provider payloads directly. This made it possible to combine stronger graph evidence with stable, token-conscious output.

Search and inspection settled into complementary lanes. Search starts from any clue and narrows toward source: path-shaped queries resolve from the current tree, concept queries use ranked backend evidence, graph and semantic modes stay explicit, and local ast-grep plus `rg` remain the verifiable fallback. Inspect starts from one known target and expands outward, using backend snippets and relationships only when the match is unambiguous and structurally recognized.

Signal provenance also became explicit. Backend `cognitive`, `cyclomatic`, and `linearScanInLoop` values are upstream Codebase Memory properties passed through after numeric normalization. Partial or degraded backend results may be completed with current-tree function rows containing source lines and lexical mentions. Function-mention and variable-name-length rankings also come from current-tree lexical analysis. Codemap owns path eligibility, deterministic ordering, field naming, and display limits; headings state the primary and tie-break criteria instead of labeling ranked definitions as problems.

Upstream session auto-indexing proved unreliable across a working session. The current lifecycle therefore serializes graph-backed operations by project root, clears the matching operational cache entry, indexes once with `persistence: false`, and reuses that clean snapshot for every backend query in the operation. Short-lived MCP children start outside the target repository so upstream watching and auto-index behavior cannot race the explicit refresh.

The default signal summary originally favored a very small sample. In practice, two to four examples from many categories created a metric buffet that encouraged agents to reopen every section. The current design sorts eligible measurements first, then keeps up to twenty rows per bucket as overflow protection. Expensive lightweight syntax enrichment remains independently bounded so a broader display does not imply proportionally broader parsing.

Once the command surface stabilized, Codemap became a globally installable npm CLI with a separate companion skill. The executable owns behavior and output; the skill owns when to use each command, how to interpret compact metrics, and which caveats matter to an agent. Repository development remains pnpm-based while `npm install -g .` provides the linked global command.

## Settled Direction

- Do not add persistent Codemap data to the inspected repository.
- Treat Codebase Memory's system-cache storage as operational state, not a human-reviewed artifact or source of truth.
- Keep explicit refresh as the default until upstream lifecycle behavior is demonstrably reliable.
- Keep Codebase Memory, current-tree scanning, `rg`, and ast-grep as distinct evidence sources with clear labels.
- Keep `src/codemap/codebase-memory` responsible for transport, freshness, serialization, generic tool-result validation, and reusable diagnostic/query operations.
- Let feature modules own provider arguments, payload projection, filtering, ranking, fallback, final composition, and compact output contracts.
- Preserve upstream metric values as upstream facts and use explicit deterministic tie-breakers for Codemap-owned ordering.
- Prefer readable text for agent use. Add normalized JSON only for stable row surfaces that benefit from `jq` or scripts.
- Emit measurements rather than prompts or recommendations. Ranking headings should state their criteria without classifying the rows as good, bad, or in need of refactoring.
- Keep interpretation rules and metric caveats in the companion skill rather than repeating explanatory prose in every command result.
- Keep the installed command as the behavior surface and the companion skill as a thin agent operating contract.
- Keep Python and TypeScript/JavaScript, including frontend source, as the supported language scope.

## Enhancement Directions

### Additional Rankings

New default rankings should expose a distinct measurable relationship rather than add another generic metric. Promising directions include:

- High fan-in symbols that also carry substantial size or complexity.
- Similar implementation clusters with concrete source anchors.
- Dependency cycles or boundary crossings that concentrate change pressure.
- Exported definitions with weak usage evidence, clearly labeled as leads rather than dead-code proof.
- Intersections between existing measurements, such as complex functions in dense files, when the intersection removes noise rather than merely restating both lists.

A new bucket earns default placement only when its ranking is stable, its criteria are interpretable, and live output remains useful under the current per-bucket overflow caps. Otherwise it belongs in an explicit detailed section.

### Search Quality

Search enhancements should improve target discovery without collapsing distinct evidence lanes. Promising directions include:

- Result-source balance for concept searches so documentation, configuration, production source, and tests do not crowd one another accidentally.
- Ranking probes that distinguish exact symbol or path intent from broader vocabulary intent before paying for backend search.
- Relationship context that adds a useful caller, callee, importer, or owner rather than duplicating the matched source row.
- Consistent truncation and reporting of test rows omitted by default across backend and local fallbacks.

Any ranking change should be judged from the target an agent chooses next, not only from whether a relevant result appears somewhere in the list.

### Backend Lifecycle

Keep the current clean-index lifecycle simple. Revisit it only if one of these becomes true:

- Codebase Memory exposes a reliable explicit refresh through its supported MCP or SDK surface and repeated probes confirm current-tree consistency after edits and deletions.
- Update latency becomes material on repositories representative of normal Codemap use, not only exceptional monorepos.
- The backend can reuse an incremental snapshot without introducing repository-owned persistence, stale reads, or competing watchers.

Cold-build timing and incremental-update timing should remain separate measurements. Lifecycle changes must test additions, large edits, renames, and deletions rather than only unchanged re-indexing.

The current lock and child-supervision machinery is containment for an unreliable shared operational cache, not a general concurrency abstraction. Feature modules should never participate in that protocol, and an upstream atomic refresh primitive should replace it when equivalent freshness and orphan-process guarantees can be proven.

### Output Contracts

Additional fields should improve ranking, interpretation, or verification. Provider metadata, duplicate labels, verbose explanations, and values that do not change an agent's next inspection should stay out of normal output.

Provider-derived fields must retain their upstream meaning, while Codemap-derived fields must be identifiable from the owning command or skill. Composite ranking scores should remain internal unless they become independently interpretable evidence rather than merely ordering machinery.

Text and JSON do not need artificial parity everywhere. Row-oriented commands may support both from one normalized shape; composed orientation and inspection may remain text-only when a second public structure would add maintenance without improving use.

A token-oriented encoding such as TOON should become public only when measured agent use shows a material token or parsing advantage for an existing normalized row surface. It should not replace JSON for `jq`, wrap internal MCP JSON transport, or create a third contract for composed text output merely because the format exists.

### Language Scope

Do not expand language coverage by recognizing file extensions alone. A new language requires credible definition extraction, structural search, path and test filtering, signal ranking, and live probes comparable to the Python and TypeScript/JavaScript paths.

## Evaluation Standard

The standing production corpus should include LangChain Python, LangChain JS, OpenClaw, and Hermes Agent when those repositories are available, alongside toy repositories with deliberately obvious expected answers.

Before promoting an enhancement into the default surface:

1. Exercise toy repositories where expected rows are obvious.
2. Exercise medium production-style repositories for ranking quality.
3. Exercise at least one unusually large repository for latency and overflow behavior.
4. Modify and delete indexed code, refresh, and verify that stale symbols disappear.
5. Inspect readable output for noise rather than judging only test snapshots.
6. Verify normalized JSON with direct parsing or `jq` when the command exposes it.
7. Keep tests on public behavior and lifecycle invariants, not private helper structure.
8. Record default row counts and approximate output tokens across the evaluation corpus so a larger cap cannot silently erase the wrapper's token advantage.
9. Build and exercise the globally installed command from outside the repository, then confirm that companion-skill examples still match the live CLI.

The useful stopping point is a compact default that gives enough evidence to choose a focused next inspection. More available backend data is not, by itself, a reason to print more data.
