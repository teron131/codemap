---
name: evolve
description: Improve Codemap through realistic agent use, compact output design, implementation, and cross-repository verification. Use for Codemap self-evolution, choosing its next improvement, improving a command's usefulness, or proving a change on representative repositories.
---

# Evolve Codemap

Use Codemap as its user and owner. Find one material friction point, make the smallest useful improvement, and try to disprove it on real repositories.

## Workflow

1. Read `README.md`, `docs/IDEAS.md`, `skills/codemap/SKILL.md`, and only the relevant source and tests.
2. Choose a realistic agent task with a source-verified expected next target.
3. Run the public workflow before reading its implementation. Record where it hides the target, wastes time or context, obscures evidence, or fails under degradation.
4. Compare only the affected current-tree, Codebase Memory code, graph, semantic, or structural lanes.
5. State the intended public behavior, one control that must remain true, and evidence that would reject the change.
6. Implement one coherent slice at the owning boundary, rerun the same cases, review the whole diff, and stop when the slice is proven.

## Choose Evidence by Risk

Use the smallest matrix that can falsify the change:

- A toy repository with one obvious answer.
- One normal repository in the affected language.
- A second language only for shared extraction, ranking, or rendering.
- A large or mixed repository only for latency, bounds, traversal order, or truncation.
- Codemap itself when self-hosting is a useful control.

Use Transformers, LangChain Python, LangChain JS, OpenClaw, and Hermes Agent as a candidate pool, not a checklist. Substitute freely when the task still has an independently verifiable answer. Expand only when results disagree or the change crosses language, backend, lifecycle, or output-format boundaries.

For each case, keep one compact record: task, expected target, affected lanes, falsifier, first useful target and rank, evidence mix, output size, elapsed time, freshness, and next action. Add one adversarial case discovered during the work.

Run special probes only when relevant: disable the backend for fallback work; add, edit, rename, and delete toy code for lifecycle work; parse JSON directly and with `jq`; run the installed command outside the repository when the executable or companion skill changes.

## Judge the Change

Prefer current-tree correctness and freshness, earlier useful targets, explicit provenance and coverage, deterministic ordering, compact defaults, and useful degraded behavior. Do not assume one evidence lane should always rank first.

Reject changes that add noise, opaque scores, provider payloads, repository-specific policy, unmeasured lifecycle machinery, extension-only language support, or new formats without changing the agent's next action. Revise changes that work only on one repository, hide evidence behind truncation, misstate freshness, break JSON, or suppress useful fallback results.

## Keep Boundaries Clear

- Keep Codebase Memory transport, refresh, serialization, and generic validation in `src/codemap/codebase-memory`.
- Keep provider arguments, eligibility, ranking, fallback, composition, and rendering with the owning feature.
- Keep work bounds local to the expensive operation. Centralize only shared policy.
- Change the full public boundary when needed: parser, implementation, renderer, exports, docs, skill, and public tests.
- Keep executable output factual and compact. Put usage in `skills/codemap/SKILL.md`, public behavior in `README.md`, and durable decisions in `docs/IDEAS.md`.
- Preserve the established output and truncation contracts. Do not duplicate detailed product rules here.

## Log the Work

Keep a concise `LOGBOOK.md` while evolving Codemap. Record material tasks, expectations, evidence, decisions, results, edge cases, limitations, and verification. Do not dump raw command transcripts or repeated probes.

## Verify and Finish

Test public behavior and lifecycle invariants rather than private helper shape. Run formatting, lint, typecheck, focused tests, build, and live commands in proportion to the change. Confirm the companion skill matches the live CLI when relevant.

Report the friction, improvement, changed contracts, before-and-after evidence, verification, and remaining evidence-backed limitation. Remove temporary evolution artifacts and stop after one proven high-leverage slice.
