---
name: evolve
description: Improve Codemap through realistic agent use, compact output design, implementation, and cross-repository verification. Use for Codemap self-evolution, choosing its next improvement, improving command usefulness or performance, or proving a behavior-preserving restructure.
---

# Evolve Codemap

Use Codemap as its user and owner. Start from the requested outcome and a material friction point, make the smallest coherent improvement, and try to disprove it on real repositories. Internal work can succeed through clearer ownership or less repeated work while preserving the existing features; it does not need a new command or output field.

## Workflow

1. Read `README.md`, `docs/IDEAS.md`, `skills/codemap/SKILL.md`, and only the relevant source and tests.
2. Choose a realistic agent task with a source-verified expected next target.
3. Establish the public workflow before changing its implementation. Record where it hides the target, wastes time or context, obscures evidence, or fails under degradation.
4. Compare only the affected current-tree, Codebase Memory code, graph, semantic, or structural lanes.
5. State what should improve, which public behavior and lifecycle guarantees must remain true, and evidence that would reject the change.
6. Implement the coherent change at the owning boundary, migrate affected callers, rerun the same cases, review the whole diff, and stop when the requested outcome is proven.

## Choose Evidence by Risk

Use the smallest matrix that can falsify the change:

- A toy repository with one obvious answer.
- One normal repository in the affected language.
- A second language only for shared extraction, ranking, or rendering.
- A large or mixed repository only for latency, bounds, traversal order, or truncation.
- Codemap itself when self-hosting is a useful control.

Choose the relevant subset of the [public repository pool](#public-repository-pool) below rather than running the whole pool. Expand when results disagree or the change crosses language, backend, lifecycle, or output-format boundaries.

For each case, keep one compact record of the task, expected target, affected lanes, falsifier, result, and next action. Record rank, evidence mix, output size, elapsed time, and freshness when they bear on the change. Add an adversarial case when the work exposes a plausible failure.

For behavior-preserving work, compare stdout, stderr, and exit status before and after on identical fixtures. Include affected ordering, language variants, candidate limits, degraded results, and JSON truncation. For performance claims, take repeated measurements and interleave baseline and changed runs when practical; distinguish local source work, process startup, and backend refresh. A single faster run or a reduced evidence set does not establish an optimization.

Run special probes only when relevant: disable the backend for fallback work; add, edit, rename, and delete toy code for lifecycle work; parse JSON directly and with `jq`; run the installed command outside the repository when the executable or companion skill changes.

## Public Repository Pool

Use regular references to judge useful defaults, the optional library case for library-specific work, and stress cases for scale, bounds, truncation, or degradation. Choose one or two cases relevant to the change and keep frontend and framework work represented alongside frontier agent systems.

| Repository | Role | Main languages | Rough source lines | Size class | Distinct coverage |
| --- | --- | --- | ---: | --- | --- |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Regular frontier-agent reference | Python, TypeScript | 1.0M | XL | Tool execution, concurrency, CLI/gateway coordination, and desktop application boundaries. |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Regular frontier-agent reference | TypeScript; small Python SDK | 330k | L | Plugin composition, services, typed events, and agent/session lifecycle. |
| [Django](https://github.com/django/django) | Regular framework reference | Python | 150k | M | Inheritance, metaclasses, ORM behavior, public re-exports, and indirect dispatch. |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | Regular interactive-application reference | TypeScript | 130k | M | React canvas UI, geometry, registered actions, and state/history updates. |
| [Cal.diy](https://github.com/calcom/cal.diy) | Regular full-stack reference | TypeScript | 380k | L | Next.js, tRPC, Prisma, and feature boundaries across application packages. |
| [LangChain JS](https://github.com/langchain-ai/langchainjs) | Optional library case | TypeScript | 180k | M | Generic public APIs, runnable composition, re-exports, and provider packages. |
| [Transformers](https://github.com/huggingface/transformers) | Python stress case | Python | 740k | XL | Repeated model families, large classes, lazy imports, generated source, and substantial tests. |
| [OpenClaw](https://github.com/openclaw/openclaw) | Extreme stress case only | Mainly TypeScript; Swift, Kotlin | 3.4M | XXL | Very large trees, multiple runtimes, traversal cost, output limits, and degraded behavior. |

Hermes and DeepSeek Harness cover frontier agent systems despite their different scale. Use focused Hermes tasks for ordinary navigation checks. DeepSeek's [Cordis architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) adds service and event registration paths that direct import or call graphs cannot fully explain; it takes the regular TypeScript-agent slot while LangChain JS remains optional. OpenClaw is an extreme stress test and should not determine everyday defaults or serve as a reference architecture.

Sizes are rounded nonblank source lines including comments, with tests, fixtures, examples, documentation, benchmarks, vendored dependencies, build output, and obvious generated files excluded heuristically. They describe approximate repository scale rather than exact executable LOC or Codemap's eligible-file counts. M is 50k–200k lines, L is 200k–500k, XL is 500k–2M, and XXL is above 2M. These are size bands, not class-declaration counts. Native-language files contribute to size; supported analysis remains Python and TypeScript/JavaScript. Full scans can be substantially larger when tests and generated files are included. Use current checkouts and refresh estimates only when scale affects the choice of case.

Useful task seeds include tracing a Hermes tool call, locating DeepSeek's tool registration and execution, following a Django model save, finding Excalidraw's deletion/history update, or tracing Cal.diy booking behavior across frontend and server packages. Verify the expected target from source before treating a seed as a regression case; record focused path queries separately from whole-repository traversals.

LangChain Python is outside the standing pool because the selected Python framework and agent cases already cover its main roles. pytest remains a targeted candidate for fixture/plugin discovery, and VS Code for layered TypeScript service architecture. Personal projects are outside this public pool.

## Judge the Change

Prefer current-tree correctness and freshness, earlier useful targets, explicit provenance and coverage, deterministic ordering, compact defaults, and useful degraded behavior. Do not assume one evidence lane should always rank first.

Reject changes that add noise, opaque scores, provider payloads, repository-specific policy, unmeasured lifecycle machinery, extension-only language support, or new formats without changing the agent's next action. Revise changes that work only on one repository, hide evidence behind truncation, misstate freshness, break JSON, or suppress useful fallback results.

Judge maintainability separately from public output. Look for fewer competing owners, simpler caller contracts, and less repeated work. Keep cohesive workflows and idiomatic code when a rewrite only adds helpers, type indirection, or navigation.

## Keep Boundaries Clear

- Follow the ownership map in `docs/IDEAS.md`: keep refresh and failure attribution in the client, cache and lock recovery in their shared owner, and MCP envelopes and provider invocation in transport.
- Keep provider arguments, eligibility, ranking, fallback, composition, and rendering with the owning feature.
- Reuse target discovery, source reads, and parsing within one operation, then rediscover current evidence on the next command. Keep graph extraction sequencing with its graph owner and select signal collection before computing sections.
- Keep work bounds local to the expensive operation and final stdout budgeting in `commands/output.ts`. Preserve independent rule limits and deterministic ordering when batching work.
- Change the full public boundary when needed: parser, implementation, renderer, exports, docs, skill, and public tests.
- Keep executable output factual and compact. Put usage in `skills/codemap/SKILL.md`, public behavior in `README.md`, and durable decisions in `docs/IDEAS.md`.
- Preserve the established output and truncation contracts. Do not duplicate detailed product rules here.

## Log the Work

Keep a concise temporary `LOGBOOK.md` while evolving Codemap. Record material tasks, expectations, evidence, decisions, results, edge cases, limitations, and verification. Keep fixtures and benchmark artifacts under the repository's `.cache/`. Retain durable decisions and their useful evidence in `docs/IDEAS.md`; leave usage guidance in the companion skill. Do not dump raw command transcripts or repeated probes.

## Verify and Finish

Test public behavior and lifecycle invariants rather than private helper shape. Run formatting, lint, typecheck, focused tests, build, and live commands in proportion to the change, reusing existing proof where it still covers the current tree. Validate changed skills and confirm their examples match the live CLI.

Report the friction, improvement, changed or preserved contracts, before-and-after evidence, verification, and remaining evidence-backed limitation. Remove the temporary logbook and experiment artifacts after retaining useful decisions, and stop when the requested outcome is proven. If no proposed change survives the evidence, report that result.
