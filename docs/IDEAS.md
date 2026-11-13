# Codemap Ideas

Why Codemap is built the way it is, and the principles that guide its evolution.
Keep lasting decisions, trade-offs, and the criteria for revisiting them here; individual runs, repository-specific failures, and measurements belong in the temporary logbook and regression tests.
The README is the user-facing contract.

## Premise

- **Context as code.** What a command prints is the context an agent reasons from. Selection, order, naming, layout, and limits are therefore code: designed, tested, and versioned, never a pass-through of what a tool returned.
- **Agents read it and agents develop it.** Judge output by the next action an agent takes from it. Keep the repository's own structure, names, and documents so that an agent that opened only a few files makes a change that is right for the whole.
- **Named evidence sources, one backend.** Codebase Memory MCP supplies graph evidence; ripgrep and ast-grep supply exact text and syntax from the working tree. Each keeps its product name in code and in output, so a reader can always tell which source produced a row. "Backend" is only the role word for the CLI switch and status lines.
- **Vocabulary from general professional knowledge.** A term should be one an agent already knows from the field, so output needs no glossary. The backend's schema and coined labels are not that vocabulary, which is why its field names stop at the code that reads them.
- **Output is implicit context.** Every part of a result reads as a claim: a descending top list says these matter most, a heading says what the section is, and a list without a marker reads as the whole. The layout must claim exactly what the selection did, so state the criteria, label the source, and report whatever was bounded, substituted, omitted, or cut.

## Journey So Far

Codemap began as a compact layer over `rg` and ast-grep, which set the baseline: exact text and syntax matches stay fast, working-tree-first, and independently verifiable.

Codebase Memory then became the primary source for structure, symbol neighborhoods, semantic search, change impact, and function metrics, while Codemap kept selection and presentation instead of exposing backend payloads.

Search and inspection settled into complementary lanes: search narrows from any clue toward source, and inspect expands outward from one known target, using backend snippets and relationships only for unambiguous, structurally recognized matches.

Signal provenance became explicit: backend metrics pass through under Codemap's names, working-tree rows complete partial or degraded results, and Codemap owns eligibility, ordering, naming, and display limits.

The backend's session auto-indexing proved unreliable, so graph-backed operations serialize per project root, clear the matching cache entry, index once with `persistence: false`, and reuse that snapshot for every query in the operation. Short-lived MCP children start outside the target repository so the backend's watchers cannot race the refresh.

Once the commands stabilized, Codemap became a globally installable npm CLI with a separate companion skill: the executable owns behavior and output, and the skill owns when to use each command and how to read it. Source installs work with npm or pnpm, and `npm install -g .` links the global command.

A later performance pass gave backend lifecycle, cache locking, transport, and output budgeting their own modules and shared parsing within each operation, without changing output. Reuse within an operation is the first place to look for wasted work; each command still rediscovers fresh evidence.

## Settled Direction

- Do not add persistent Codemap data to the inspected repository.
- Treat Codebase Memory's system-cache storage as operational state, not a human-reviewed artifact or source of truth.
- Preserve an explicit `CBM_CACHE_DIR`, fall back from an unwritable default user cache to a private OS temporary cache, and surface the concrete backend or lifecycle reason when backend work still fails.
- Keep explicit refresh as the default until the backend's lifecycle behavior is demonstrably reliable.
- Keep Codebase Memory, working-tree scanning, `rg`, and ast-grep as distinct evidence sources with clear labels.
- Keep the detailed-analysis limit of 5,000 files separate from signal availability. Above it, scan the 100 largest eligible source files and report parsed versus eligible counts for bounded function-length and file evidence without claiming complete relationship or mention coverage.
- Skip default backend function-metric enrichment above 10,000 eligible source files. Keep the bounded working-tree signal useful and leave expensive graph work to explicit backend commands.
- Keep `src/codemap/codebase-memory` responsible for transport, freshness, serialization, generic tool-result validation, and reusable diagnostic/query operations.
- Within that boundary, keep project refresh, cache ownership, and failure attribution in Codemap while the official SDK handles MCP negotiation and messages inside the supervised process. Backend exit must precede lock handback, and cleanup failures must retain the original operation failure.
- Target Codebase Memory 0.12. The transport asks every call for JSON without the backend's byte ceiling and expands its compact `cols` tables into records once, so feature lanes read named fields. Refresh deletes only the project whose root matches exactly, because `delete_project` resolves a directory to the indexed project that contains it. A failed call reports the backend's own stderr reason, such as a daemon that cannot create its runtime directory or Unix socket under an agent sandbox, rather than the SDK's parse error.
- Keep final text and JSON budgeting in `commands/output.ts`; CLI dispatch captures stdout and applies that policy once.
- Resolve structural-search targets once per operation and evaluate related identifier rules against the same per-file parse, preserving each rule's candidate bound and the existing language order.
- Select signal collection work before computing sections. `all` shares detailed analysis and documentation coverage; full `docstrings` remains a separate request that avoids source-metric scanning.
- Keep working-tree graph assembly in `source/graph/working-tree.ts`, which projects the supplied scan and import evidence. Reuse parsed declarations, imports, and calls within an operation without retaining source state across commands.
- Make every extracted function and class a working-tree graph node so exact symbol inspection reaches short private definitions. Derive call, scope, and documentation ownership from ast-grep's preorder match stream with open-range stacks rather than per-node ancestor walks.
- Reuse one documentation report per file within a summary so most-called, cluster, and public-surface descriptions share the same parse. Keep reports in the summary's source context and rebuild them on the next command.
- Tie ownership changes to clearer contracts or less repeated work. Keep cohesive workflows together when extra helpers would add navigation without an independent responsibility.
- Let feature modules own backend arguments, payload projection, filtering, ranking, fallback, final composition, and compact output contracts.
- Keep commands to parsing flags, resolving the project root, and exit codes: `search/lanes.ts` owns the order in which search lanes answer, and each feature keeps its Codebase Memory lane in its own `codebase-memory.ts`, named for the product like `ripgrep.ts` and `ast-grep.ts` because that code is tied to its tools and payloads.
- Import another module only through its `index.ts`; when a caller needs an inner symbol, export it from the entry or move the boundary.
- Delegate language syntax, module resolution, and document structure to established libraries while retaining relevance and coverage decisions in Codemap. Resolve imports in the importing file's configuration and module context, then retain only targets in the inspected project inventory.
- Keep `summary` focused on repository purpose through introductory README content and a three-level outline with common setup and project-administration subtrees omitted. Follow with an authored-source language mix, structural signals for the repository skeleton, non-generic most-called symbols by share of all calls, production clusters described by analyzed-symbol share and internal-call share, and a focused public API skeleton.
- Infer natural repository granularity rather than ranking every barrel equally: use authored package boundaries for workspaces and the dominant importable source root's first feature level in one-package repositories. Establish the skeleton from package dependencies and resolved working-tree imports, then enrich it with bulk Codebase Memory imports and calls. Retain only distinct entry, coordination, core, and shared-foundation roles. Compress repeated same-parent paths as counted groups labeled with their item count and sorted first, middle, and last examples; insert ellipses only where those samples omit siblings, without claiming that the grouped modules are semantically alike. Recursively expand selected one-package paths only while expansion is shorter than a counted group, preserve direct files at the selected boundary, and render every compressed branch on its own line.
- Present the public API as an at-most-three-level hierarchy of public surfaces selected by shallowest entry, most working-tree importers, and most modules exposed, plus modules directly exposed through them. Nest already selected descendant surfaces relative to their closest selected ancestor without collecting additional entries, merging repeated module paths so the added depth expresses relationships rather than volume. Deeply nested surfaces must earn inclusion through import centrality rather than export volume. Resolve re-exports to their defining paths, collapse deeper paths to the first meaningful module below the surface, and retain only non-dominated module groups across fan-in, implementation evidence, and defining-module breadth. Retain named exports only when one name uniquely identifies its selected module or names strongly match the module's public role; allow an additional name-bearing module only when its fan-in or implementation breadth is a data-derived upper outlier among its peers. These module labels are structural compression, not semantic capability classifications or recommended next steps. Omit exhaustive symbol lists, positional export samples, repeated origins, unresolved relative re-exports, and test-only modules.
- Keep local skeleton evidence available when Codebase Memory degrades. Put the outline first within Overview, then structural roles before most-called symbols and clusters, and graph insight or its explicit degradation status before the public API. Do not repeat raw graph inventory, repeat the package root inside its own skeleton, or rely on the shared stdout ceiling to select summary content.
- Pass backend metric values through unchanged and use explicit deterministic tie-breakers for Codemap-owned ordering.
- Name output terms for the reader: an established term such as `cyclomatic` or `cognitive`, otherwise a plain name for what the number points to, such as `hidden_quadratic` for the backend's `linear_scan_in_loop`. One concept keeps one name across text, JSON, code, and the skill. A ranked or selected view is a signal; a plain measured number is a metric.
- Keep population statistics on homogeneous numeric measurements before presentation truncation: `count`, `mean`, sample `std`, `min`, `p25`, `p50`, `p75`, `p90`, `max`, and data-derived `bins`. Use the shared Sturges-sized binning heuristic with at most ten equal-width ranges and no metric-specific thresholds. Do not summarize source line positions or treat backend top-N rows as a population; bounded scans describe only their parsed rows.
- Omit likely test rows by default across backend and local discovery. `--include-tests` opts in, while explicit paths and exact symbol definitions remain direct working-tree targets.
- Keep direct paths, exact symbol definitions, and bounded exact multi-word implementation text working-tree-first. Also prefer working-tree candidates when every meaningful term occurs in source within one 50-line window, at least two terms share a line, and the result is decisive: at most three complete candidates or one uniquely path-aligned complete candidate. Path affinity ranks candidates but never supplies missing source coverage. Render that evidence once per file with coverage and concrete anchors. For weaker ordinary source search, prioritize Codebase Memory code search and reuse the working-tree preflight when the backend is unavailable or has no usable answer. Keep relationship and vocabulary-bridging work in the explicit `--graph` and `--semantic` lanes, while allowing an exact working-tree definition to end semantic search before noisy backend ranking can hide it.
- Treat concise multi-word queries as possible camelCase, PascalCase, or snake_case definition intent before broader search, and include class methods, class fields, and constants initialized with a function in the same working-tree definition and inspection surface as other function-like symbols.
- Resolve a qualified name such as `Model.save` to the definitions of its last segment that belong to the segment before it, in search and in local inspection alike, because that is how an agent names a method and a text search for it returns call sites and comments. Membership is one rule over a file's scanned spans: directly in the body of a class with that name, or outside every class and function in a file with that name. Search looks only inside the files that declare or are named for the owner, so a common member name neither scans the tree nor exhausts the candidate bound, and a name with no such member is read as a phrase as before. Interface, object-literal, and re-exporting package owners stay unresolved until syntax evidence for them exists.
- Preserve symbol identity and definition boundaries from discovery through inspection, including when backend evidence is unavailable. Share the extraction logic that establishes those facts so their interpretations remain consistent. Use syntax evidence for declarations and ownership, and report parsing failures separately from missing documentation.
- Keep local function and method inspection focused on the selected target's location, documentation, relationships, file context, and other matches. Omit the whole-file function inventory from these answers because it dominated function answers in large files without changing the next inspection; inspect the owning file when that inventory is needed. File and class inspection retain the inventory, which still supplies class method discovery when containment edges do not. This is an output selection rule, not a claim that local relationship discovery avoids repository-wide work.
- Apply result limits after filtering and merging repeated evidence, while preserving distinct definitions. Compact output must retain the context and document structure needed to interpret what remains.
- When a phrase has no useful whole-query source answer, collect matching file paths for each bounded normalized term, prefer supported implementation candidates, and keep only the strongest file-level coverage tier before ordinary source usefulness. Within equal coverage and path usefulness, order multi-term file candidates by their narrowest cohesive window and anchor that window, because alphabetical order and first occurrences hid owners in large tiers behind incidental mentions. Read only the leading candidate groups that can reach the display, at most 1,000 files, and label a ranking cut by that bound as a prefix. Preserve at most two single-term and eight multi-term fallback candidates with an omitted count, and never claim complete coverage when the query exceeds the term bound or a ripgrep scan is truncated or fails.
- Send ranked graph search only the filters the backend applies alongside a query, label and file pattern, and check name and qualified-name patterns on its rows. Relationship, degree, and entry-point filters answer from the working-tree graph with that reason stated, because ranked backend rows carry no edges or degrees.
- Keep normal source, graph, and semantic search at 15 displayed matches by default while preserving explicit `--limit` overrides and independent backend over-fetching for test suppression.
- Treat backend semantic scores below 0.5 as insufficient evidence and use the working-tree fallback instead of presenting low-confidence ranking noise.
- Keep backend function-metric queries at 100 rows over functions and methods, ranked and filtered by test flag and supported language in the query itself so the row limit keeps the true top rows; the backend orders by returned aliases, not expressions. When source eligibility removes backend rows, append distinct working-tree rows before the final output budget instead of widening the backend payload.
- Prefer readable compact text for agent use and object-row JSON for stable surfaces that benefit from `jq` or scripts. Let composed summaries borrow TOON's schema-once principle by declaring field order in section headings, emitting compact positional records, and using trees for hierarchy; token efficiency alone does not justify a third public encoding.
- Treat 10,000 conservatively estimated tokens as the overflow ceiling for every command, not a target commands should fill. Apply it once to final stdout and report total, shown, and truncated counts. Keep JSON valid and `jq`-compatible by reporting its truncation on stderr. Do not stack presentation caps or repeat compact summary projections in broad detailed views. Bound expensive collection or enrichment separately only to limit work.
- Emit measurements rather than prompts or recommendations. Ranking headings should state their criteria without classifying the rows as good, bad, or in need of refactoring.
- Keep interpretation rules and metric caveats in the companion skill, a thin operating contract, rather than in every command result.
- Keep Python and TypeScript/JavaScript, including frontend source, as the supported language scope.
- Bundle Python structural matching through ast-grep's dynamic NAPI language package so normal patterns, rules, and call searches do not depend on a separately installed CLI.

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
- Relationship context that adds a useful caller, callee, importer, or owner rather than duplicating the matched source row.
- Consistent reporting of test rows omitted by default across backend and local fallbacks.
- Consistent definition context across discovery and inspection, including documentation and nested scopes.

Any ranking change should be judged from the target an agent chooses next, not only from whether a relevant result appears somewhere in the list.

### Backend Lifecycle

Keep the current clean-index lifecycle simple. Revisit it only if one of these becomes true:

- Codebase Memory exposes a reliable explicit refresh through its supported MCP or SDK surface and repeated probes confirm working-tree consistency after edits and deletions.
- Update latency becomes material on repositories representative of normal Codemap use, not only exceptional monorepos.
- The backend can reuse an incremental snapshot without introducing repository-owned persistence, stale reads, or competing watchers.

Cold-build timing and incremental-update timing should remain separate measurements. Lifecycle changes must test additions, large edits, renames, and deletions rather than only unchanged re-indexing.

Verify backend query shapes against the installed backend. Do not rely on unprobed label expressions because fallback rows can make a backend-query incompatibility look like ordinary metric absence.

The current lock and child-supervision machinery is containment for an unreliable shared operational cache, not a general concurrency abstraction. Feature modules should never participate in that protocol, and a backend atomic refresh primitive should replace it when equivalent freshness and orphan-process guarantees can be proven.

### Output Contracts

A field earns its place by improving ranking, interpretation, or verification; backend metadata, duplicate labels, verbose explanations, and values that do not change the next inspection stay out.

Backend-derived fields must retain their value and meaning under Codemap's name, while Codemap-derived fields must be identifiable from the owning command or skill. Composite ranking scores should remain internal unless they become independently interpretable evidence rather than merely ordering machinery.

Text and JSON need no artificial parity: row-oriented commands may offer both from one normalized shape, while composed orientation and inspection stay text-only when a second structure would add maintenance without improving use.

TOON was trialed and showed no material advantage over compact JSON, which shares its schema-once, positional-row idea. Keep JSON minified and object-oriented for `jq`, keep compact text as the agent surface, and do not add TOON as a third encoding or wrap internal MCP JSON transport.

### Language Scope

Do not expand language coverage by recognizing file extensions alone. A new language requires credible definition extraction, structural search, path and test filtering, signal ranking, and live probes comparable to the Python and TypeScript/JavaScript paths.

## Evaluation Standard

Design from the agent user's next action under the premise above, then use repository evaluation to falsify that design. Do not average unrelated repository quirks into an incoherent default merely because the corpus is diverse.

Choose the smallest representative corpus that can expose a regression. The [evolve skill's public repository pool](../.agents/skills/evolve/SKILL.md#public-repository-pool) records the selected frontier-agent, framework, application, optional library, and stress cases with their languages and approximate sizes. Use ordinary references to judge useful defaults and extreme repositories to test bounds and degradation. Shared extraction needs both supported language families; backend lifecycle work needs edits, renames, deletions, and failure recovery. Expand when the evidence disagrees.

Behavior-preserving changes should compare stdout, stderr, and exit status on identical source fixtures, including ordering, coverage, and truncation. Performance comparisons need repeated measurements against the same inputs and environment, with local parsing, process startup, and backend refresh costs distinguished where they affect the conclusion. A faster command must retain the evidence and freshness guarantees that made its answer useful.

For output or ranking changes, judge the first useful target, result-source mix, row count, output size, and the next action an agent can take. Inspect readable output, parse exposed JSON, and keep regression coverage on public behavior and lifecycle invariants. Verify installed execution outside the repository when packaging or executable behavior changes, and check companion-skill examples against the live CLI when usage changes.

Use `.agents/skills/evolve/SKILL.md` for the evaluation loop. Assess clearer ownership separately from public behavior, so a passing test suite alone does not justify a structural change.

Stop at a compact default that gives enough evidence to choose a focused next inspection; more available backend data is not by itself a reason to print more.
