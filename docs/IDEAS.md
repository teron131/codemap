# Codemap Ideas

This document records how Codemap's current design emerged and what evidence should guide future enhancements. It is neither a release history nor a committed roadmap; the README remains the user-facing contract.

## Journey So Far

Codemap began as a compact, opinionated layer over `rg` and ast-grep. Those tools established the baseline: exact text and syntax-aware matches should remain fast, current-tree-first, and independently verifiable.

Codebase Memory later became the primary source for repository structure, symbol neighborhoods, semantic search, change impact, and function metrics. Codemap kept ownership of selection and presentation instead of exposing provider payloads directly. This made it possible to combine stronger graph evidence with stable, token-conscious output.

Search and inspection settled into complementary lanes. Search starts from any clue and narrows toward source: paths and exact definitions resolve from the current tree, ordinary concept and text queries prioritize ranked backend code search, graph and semantic modes stay explicit, and local ast-grep plus `rg` remain the verifiable fallback. Inspect starts from one known target and expands outward, using backend snippets and relationships only when the match is unambiguous and structurally recognized.

Signal provenance also became explicit. Backend `cognitive`, `cyclomatic`, and `linearScanInLoop` values are upstream Codebase Memory properties passed through after numeric normalization. Partial or degraded backend results may be completed with current-tree function rows containing source lines and lexical mentions. Function-mention and variable-name-length rankings also come from current-tree lexical analysis. Codemap owns path eligibility, deterministic ordering, field naming, and display limits; headings state the primary and tie-break criteria instead of labeling ranked definitions as problems.

Upstream session auto-indexing proved unreliable across a working session. The current lifecycle therefore serializes graph-backed operations by project root, clears the matching operational cache entry, indexes once with `persistence: false`, and reuses that clean snapshot for every backend query in the operation. Short-lived MCP children start outside the target repository so upstream watching and auto-index behavior cannot race the explicit refresh. An explicit Codebase Memory cache path remains authoritative; an unwritable default user cache falls back to a private OS temporary cache.

Once the command surface stabilized, Codemap became a globally installable npm CLI with a separate companion skill. The executable owns behavior and output; the skill owns when to use each command, how to interpret compact metrics, and which caveats matter to an agent. Source installation works with npm or pnpm, while `npm install -g .` provides the linked global command.

## Settled Direction

- Do not add persistent Codemap data to the inspected repository.
- Treat Codebase Memory's system-cache storage as operational state, not a human-reviewed artifact or source of truth.
- Preserve an explicit `CBM_CACHE_DIR`. Fall back from an unwritable default user cache to a private OS temporary cache, and surface the concrete provider or lifecycle reason when backend work still fails.
- Keep explicit refresh as the default until upstream lifecycle behavior is demonstrably reliable.
- Keep Codebase Memory, current-tree scanning, `rg`, and ast-grep as distinct evidence sources with clear labels.
- Keep the detailed-graph threshold separate from signal availability. Above it, scan the 100 largest eligible source files and report parsed versus eligible counts for bounded function-length and file evidence without claiming complete relationship or mention coverage.
- Skip default backend function-metric enrichment above 10,000 eligible source files. Keep the bounded current-tree signal useful and leave expensive graph work to explicit backend commands.
- Keep `src/codemap/codebase-memory` responsible for transport, freshness, serialization, generic tool-result validation, and reusable diagnostic/query operations.
- Let feature modules own provider arguments, payload projection, filtering, ranking, fallback, final composition, and compact output contracts.
- Preserve upstream metric values as upstream facts and use explicit deterministic tie-breakers for Codemap-owned ordering.
- Omit likely test rows by default across backend and local discovery. `--include-tests` opts in, while explicit paths and exact symbol definitions remain direct current-tree targets.
- Keep direct paths, exact symbol definitions, and bounded exact multi-word implementation text current-tree-first. Also prefer current-tree candidates when every meaningful term occurs in source within one 50-line window, at least two terms share a line, and the result is decisive: at most three complete candidates or one uniquely path-aligned complete candidate. Path affinity ranks candidates but never supplies missing source coverage. Render that evidence once per file with coverage and concrete anchors. For weaker ordinary source search, prioritize Codebase Memory code search and reuse the current-tree preflight when the backend is unavailable or has no usable answer. Keep relationship and vocabulary-bridging work in the explicit `--graph` and `--semantic` lanes.
- When a phrase has no useful whole-query source answer, collect matching file paths for each bounded normalized term, prefer supported implementation candidates, and keep only the strongest file-level coverage tier before ordinary source usefulness. Preserve at most two single-term and eight multi-term fallback candidates with an omitted count, read concrete anchors only for displayed candidates, and never claim complete coverage when the query exceeds the term bound or a ripgrep scan is truncated or fails.
- Keep backend function-metric queries at 100 rows. When source eligibility removes provider rows, append distinct current-tree rows before the final output budget instead of widening the provider payload.
- Prefer readable compact text for agent use and object-row JSON for stable surfaces that benefit from `jq` or scripts. Token efficiency alone does not justify replacing either with a third public encoding.
- Treat 10,000 conservatively estimated tokens as the overflow ceiling for every command, not a target commands should fill. Apply it once to final stdout and report total, shown, and truncated counts. Keep JSON valid and `jq`-compatible by reporting its truncation on stderr. Do not stack presentation caps or repeat compact summary projections in broad detailed views. Bound expensive collection or enrichment separately only to limit work.
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

A new ranking earns default placement only when its ordering is stable, its criteria are interpretable, and live output remains useful under the shared final-output ceiling. Otherwise it belongs in an explicit detailed section.

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

Verify backend query shapes against the installed provider. Do not rely on unprobed label expressions because fallback rows can make a provider-query incompatibility look like ordinary metric absence.

The current lock and child-supervision machinery is containment for an unreliable shared operational cache, not a general concurrency abstraction. Feature modules should never participate in that protocol, and an upstream atomic refresh primitive should replace it when equivalent freshness and orphan-process guarantees can be proven.

### Output Contracts

Additional fields should improve ranking, interpretation, or verification. Provider metadata, duplicate labels, verbose explanations, and values that do not change an agent's next inspection should stay out of normal output.

Provider-derived fields must retain their upstream meaning, while Codemap-derived fields must be identifiable from the owning command or skill. Composite ranking scores should remain internal unless they become independently interpretable evidence rather than merely ordering machinery.

Add automatic pandas-like statistics only to homogeneous numeric populations already owned by a command. Use `count`, `mean`, sample `std`, `min`, `p25`, `p50`, `p75`, `p90`, `max`, and data-derived `bins`, computed before final presentation truncation. Bin ranges must adapt from the observed extent through one shared heuristic: Sturges-sized, at most ten equal-width ranges, with no metric-specific thresholds. Do not summarize arbitrary numeric fields such as source line numbers, and do not treat a backend top-N result as a population. Bounded scans must keep their coverage explicit.

Text and JSON do not need artificial parity everywhere. Row-oriented commands may support both from one normalized shape; composed orientation and inspection may remain text-only when a second public structure would add maintenance without improving use.

TOON has been trialed and showed no material advantage over column-oriented compact JSON; both use the same schema-once, positional-row idea. Keep JSON output minified and object-oriented for `jq` and scripts, and keep compact text as the token-efficient agent surface. Do not add TOON as a third public encoding or wrap internal MCP JSON transport.

### Language Scope

Do not expand language coverage by recognizing file extensions alone. A new language requires credible definition extraction, structural search, path and test filtering, signal ranking, and live probes comparable to the Python and TypeScript/JavaScript paths.

## Evaluation Standard

Design from the agent user's next action under the settled philosophy, then use repository evaluation to falsify that design. Do not average unrelated repository quirks into an incoherent default merely because the corpus is diverse.

The standing production corpus should include Transformers, LangChain Python, LangChain JS, OpenClaw, and Hermes Agent when those repositories are available, alongside toy repositories with deliberately obvious expected answers.

Before promoting an enhancement into the default surface:

1. Exercise toy repositories where expected rows are obvious.
2. Exercise medium production-style repositories for ranking quality.
3. Exercise at least one unusually large repository for latency and overflow behavior.
4. Modify and delete indexed code, refresh, and verify that stale symbols disappear.
5. Inspect readable output for noise rather than judging only test snapshots.
6. Verify normalized JSON with direct parsing or `jq` when the command exposes it.
7. Keep tests on public behavior and lifecycle invariants, not private helper structure.
8. Record the first useful target rank, result-source mix, default row count, output bytes and approximate tokens, elapsed time, and backend freshness across the corpus.
9. Build and exercise the globally installed command from outside the repository, then confirm that companion-skill examples still match the live CLI.

The useful stopping point is a compact default that gives enough evidence to choose a focused next inspection. More available backend data is not, by itself, a reason to print more data.
