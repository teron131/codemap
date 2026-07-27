---
name: evolve
description: Improve Codemap through realistic agent use, compact output design, implementation, and cross-repository verification. Use for Codemap self-evolution, choosing its next improvement, improving a command's usefulness, or proving a change on representative repositories.
---

# Evolve Codemap

Act as Codemap's user and owner. Find one material friction point, improve it under the settled philosophy, and try to falsify the result on real repositories.

## Loop

1. Read `README.md`, `docs/IDEAS.md`, `skills/codemap/SKILL.md`, and only the source and tests relevant to the behavior.
2. Use the public commands on a real navigation, diagnosis, or refactor task before inspecting their implementation.
3. Notice where Codemap hides the useful target, requires unnecessary follow-up reads, prints useless data, obscures freshness or coverage, fails without the backend, or spends too much time or context.
4. Choose the smallest coherent change that most improves the agent's next action. Do not wait for the user to prescribe its details.
5. State the intended public behavior and what evidence would disprove it.
6. Implement, test, review the whole diff, and stop after one proven high-leverage slice.

Prefer:

- Current-tree correctness.
- Useful targets appearing earlier.
- Clear evidence source, freshness, scope, and truncation.
- Compact defaults that lead naturally to one focused inspection.
- Useful local evidence when Codebase Memory is unavailable or partial.
- Deterministic and explainable ordering.

Avoid:

- More output or fields because they are available.
- Metrics that restate existing rankings.
- Opaque composite scores.
- Provider payloads in public contracts.
- Repository-specific thresholds presented as generic behavior.
- New persistence or lifecycle machinery without measured need.
- New languages supported only by file extension.
- New public formats without a measured agent-use advantage.

## Keep Ownership Clear

- Keep Codebase Memory transport, refresh, serialization, and generic validation in `src/codemap/codebase-memory`.
- Keep provider arguments, projection, eligibility, ranking, fallback, composition, and rendering with the owning feature.
- Centralize policy only when it applies across commands. Keep work limits local to the expensive operation they bound.
- Keep executable output factual. Put usage and interpretation in `skills/codemap/SKILL.md`, public behavior in `README.md`, and durable decisions in `docs/IDEAS.md`.
- Replace changed surfaces directly; do not retain compatibility aliases or duplicate contracts.

## Keep Output Useful and Small

Use compact readable text for agents. Use minified object-row JSON only for stable surfaces that benefit from `jq` or scripts.

For every command:

- Put evidence that determines the next action first.
- Remove fields, headings, repeated labels, metadata, and explanations that do not change interpretation.
- Emit measurements and provenance, not advice.
- Sort the eligible results before presentation truncation.
- Apply one final conservative 10,000-token estimate to stdout as overflow protection, not as a target.
- Do not stack category, renderer, transport, and final-output caps.
- Bound expensive collection or enrichment separately only to control work.
- Report total, shown, and truncated counts.
- Keep truncated JSON valid and report its truncation on stderr.
- State when a bounded scan or backend top-N result is not the full population.

Use a simple conservative token heuristic. Predictable protection matters more than exact tokenizer agreement.

Do not add TOON, TSV, column JSON, or another positional format merely to save whitespace. TOON and column JSON have already shown no material advantage over compact text; keep object-row JSON for `jq`.

Add statistics only for a homogeneous numeric population when they help orient the agent:

- Use `count`, `mean`, sample `std`, `min`, `p25`, `p50`, `p75`, `p90`, and `max`.
- Derive bins from the data with one Sturges-sized heuristic, at most ten equal-width ranges.
- Compute the summary before final output truncation and state coverage.
- Do not predefine metric-specific bins, summarize arbitrary numeric fields, treat backend top-N rows as a population, replace useful rankings, or add a chart without a clearer decision.

## Implement Simply

Change the full public boundary when needed: parser, implementation, renderer, export, documentation, skill, and public tests.

Keep main flows top-to-bottom. Inline shallow one-use wrappers, remove duplicate checks and impossible branches, and extract a helper only when it owns a reusable rule.

Test public behavior and lifecycle invariants rather than private helper shape. Run the formatter, linter, typecheck, focused tests, build, and live commands in proportion to the change.

## Test Realistically

Use a toy repository with an obvious answer, a medium production repository, one unusually large repository, and each affected language lane.

Use the available standing corpus:

- Transformers.
- LangChain Python.
- LangChain JS.
- OpenClaw.
- Hermes Agent.

Exercise the public workflow, not only renderers:

- Follow the default result to the next target.
- Compare current-tree and backend-enriched behavior when relevant.
- Confirm backend failure leaves useful local evidence.
- For lifecycle work, add, edit, rename, and delete code in a disposable toy repository and verify stale symbols disappear.
- Parse JSON directly and with `jq`.
- Inspect text for noise.
- Build and run the globally installed command outside the Codemap repository.
- Confirm `skills/codemap/SKILL.md` still matches the live CLI.

Record the first useful target and rank, evidence-source mix, rows, bytes, approximate tokens, elapsed time, backend freshness, and the next action.

Revise or reject a change when it gives the wrong obvious answer, hides useful evidence behind truncation, misstates freshness or coverage, breaks JSON, suppresses local evidence after backend failure, adds data that does not change the next action, or only works well on one repository.

## Finish

Report the friction, chosen improvement, material contracts changed, before-and-after evidence, verification, and any remaining evidence-backed limitation. Keep the report compact.
