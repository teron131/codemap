---
name: evolve
description: Improve Codemap through realistic agent use, compact output design, implementation, and cross-repository verification. Use for Codemap self-evolution, choosing its next improvement, improving command usefulness or performance, or proving a behavior-preserving restructure.
---

# Evolve Codemap

Use Codemap as its user and owner. Start from the requested outcome and a material friction point, make the smallest coherent improvement, and try to disprove it on real repositories. Internal work can succeed through clearer ownership or less repeated work alone; it needs no new command or output field.

## Workflow

1. Read `README.md`, `docs/IDEAS.md`, `skills/codemap/SKILL.md`, and only the relevant source and tests.
2. Choose a realistic agent task with a source-verified expected next target, [finding one by use](#find-friction-by-using-it) when the request names none.
3. Establish the public workflow before changing its implementation. Record where it hides the target, wastes time or context, obscures evidence, or fails under degradation.
4. Compare only the affected working-tree, Codebase Memory code, graph, semantic, or structural lanes.
5. State what should improve, which public behavior and lifecycle guarantees must remain true, and evidence that would reject the change.
6. [Check direction](#check-direction-before-building): proceed when the change keeps Codemap what it is, and ask the user when it would change that.
7. Implement the coherent change at the owning boundary, migrate affected callers, rerun the same cases, review the whole diff, and stop when the requested outcome is proven.

## Find Friction by Using It

Evidence comes from commands run in this session. Codemap keeps no usage log and should not grow one: agents run it mid-edit, so the tree a past command saw is usually uncommitted and cannot be rebuilt, and an old output with nothing to rerun against proves nothing about a change.

When the request names no friction, find one before reading much source. Take one or two pool repositories and navigate them for real, typing what you would type mid-task, since you are the kind of reader Codemap serves. Reach the same target from several forms of clue, because a target found one way and hidden another is the commonest friction: a path, a bare name, a qualified name such as `Owner.member`, a phrase that spells a definition, a question, and a quoted message. Follow each search with the inspection an agent would run next, and take any next step the output itself suggests.

Read each result whole, as its reader would. A miss is a wrong or absent first target, and also a row whose source label shows weaker evidence than the tree holds, such as a text match where a definition exists, a status line that explains nothing, or a suggested command that leads back to the same miss. Confirm the expected target with `rg` in that checkout before calling a result wrong.

Choose one friction, or several that share a cause, and carry the rest to the report.

## Check Direction Before Building

Runs are autonomous, and many small sensible changes can add up to a tool its owner never asked for. So once the change is chosen and before the first edit, decide which kind it is and write that in the logbook with the statement it serves.

A change is in direction when it makes Codemap better at what it already says it does. Proceed without asking.

- **Fix**: a statement in `README.md`, `skills/codemap/SKILL.md`, or `docs/IDEAS.md` is false for a source-verified case, and the change makes it true. Quote the statement.
- **Optimization**: the same answers for less time, output, or code, shown by controls that stay byte-identical.
- **Refinement**: an existing command serves its stated purpose better through what it selects, ranks, words, or bounds. Quote the purpose.

A change of direction alters what Codemap is, and that decision belongs to the user:

- A command or flag added or removed, or a command given a different purpose.
- A new evidence source, dependency, language, output format, persistent state, or network use.
- Anything that contradicts the Premise or a Settled Direction entry in `docs/IDEAS.md`, or needs one rewritten.

Then check the sum, because each step can pass while the total drifts. Read the last ten commit subjects with this change added. If together they would make README's opening paragraph, its Core Commands table, or the Premise describe Codemap wrongly, treat the change as one of direction.

For a change of direction, stop before editing and put it to the user: the friction, the smallest in-direction alternative, and what the change would add or drop. Build only what they choose. With no one to ask, build the in-direction alternative when there is one, and otherwise report the proposal and stop. Record the answer in Settled Direction either way, so a later run does not raise it again.

When a friction can be removed by correcting an existing rule or by adding a new one, prefer the correction, since additions are how drift accumulates.

## Hold a Baseline

Build the unedited tree before the first edit and compare builds side by side. The installed `codemap` cannot be the baseline: it runs this repository's `dist/`, so it changes with every build and may already lag `HEAD`.

```sh
pnpm exec tsc -p tsconfig.build.json --outDir .cache/<run>/baseline/dist && cp package.json .cache/<run>/baseline/
node .cache/<run>/baseline/dist/codemap/cli.js --version
```

Build the edited tree the same way into a sibling directory; the copied `package.json` is where a build reads its version. Put the cases in one script that takes a build and saves each case's stdout, stderr, and exit status, so before and after run identical commands and the comparison is a file diff.

For a behavior change, name two sets before editing: targets that must change, each with its source-verified answer, and controls that must stay byte-identical. Put the queries nearest the change among the controls, the ones that share its shape and should fall through it, because an over-broad rule shows there first.

Run both builds under the same backend availability. A sandbox that blocks the Codebase Memory daemon turns every graph-backed case into a fallback, so a comparison that mixes sandboxed and unsandboxed runs measures the sandbox.

## Choose Evidence by Risk

Use the smallest matrix that can falsify the change:

- A toy repository with one obvious answer.
- One normal repository in the affected language.
- A second language only for shared extraction, ranking, or rendering.
- A large or mixed repository only for latency, bounds, traversal order, or truncation.
- Codemap itself when self-hosting is a useful control.

Choose the relevant subset of the [public repository pool](#public-repository-pool) below rather than running the whole pool. Expand when results disagree or the change crosses language, backend, lifecycle, or output-format boundaries. Clone a pool repository into `.cache/corpora/<name>` and reuse a checkout already there, since these are too large to fetch on every run.

For each case, keep one compact record of the task, expected target, affected lanes, falsifier, result, and next action. Record rank, evidence mix, output size, elapsed time, and freshness when they bear on the change. Add an adversarial case when the work exposes a plausible failure.

For behavior-preserving work, compare stdout, stderr, and exit status before and after on identical fixtures. Include affected ordering, language variants, candidate limits, degraded results, and JSON truncation. For performance claims, take repeated measurements and interleave baseline and changed runs when practical; distinguish local source work, process startup, and backend refresh. Measure through process exit so native parser teardown and backend shutdown are included. A single faster run or a reduced evidence set does not establish an optimization. Time the controls as well as the targets: a new lane taxes every query that falls through it, and only the cases the change was not meant to touch show that cost.

For parser or resolver changes, verify declarations, documentation anchors, call ownership, and local import edges against source or an independent parser, using relevant cases such as nested syntax, inherited and nested TypeScript configurations, package import/require conditions, missing configuration, and edits between commands. Comments and string examples must not fabricate declarations or calls, and targets outside the inspected inventory must not become local edges. Run a new syntax rule against every grammar it applies to, on a toy file it must match: a rule naming a node kind its grammar lacks throws, and structural search then skips the file without a message, so a rule can work in TypeScript and match nothing in JavaScript.

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

Use focused Hermes tasks for ordinary navigation checks. DeepSeek's [Cordis architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) adds service and event registration that import or call graphs cannot fully explain, so it holds the regular TypeScript-agent slot while LangChain JS stays optional. OpenClaw tests extremes only and should not set everyday defaults.

Sizes are rounded nonblank source lines, comments included, excluding tests, fixtures, examples, documentation, benchmarks, vendored code, build output, and obvious generated files; they show approximate scale, not Codemap's eligible-file counts. M is 50k–200k lines, L 200k–500k, XL 500k–2M, and XXL above 2M. Refresh them only when scale affects the choice of case.

Useful task seeds include tracing a Hermes tool call, locating DeepSeek's tool registration and execution, following a Django model save, finding Excalidraw's deletion/history update, or tracing Cal.diy booking behavior across frontend and server packages. Verify the expected target from source before treating a seed as a regression case; record focused path queries separately from whole-repository traversals.

LangChain Python is outside the standing pool because the selected Python framework and agent cases already cover its main roles. pytest remains a targeted candidate for fixture/plugin discovery, and VS Code for layered TypeScript service architecture. Personal projects are outside this public pool.

## Judge the Change

Prefer working-tree correctness and freshness, earlier useful targets, explicit provenance and coverage, deterministic ordering, compact defaults, and useful degraded behavior. Do not assume one evidence lane should always rank first.

Reject changes that add noise, opaque scores, backend payloads, repository-specific policy, unmeasured lifecycle machinery, extension-only language support, or new formats without changing the agent's next action. Revise changes that work only on one repository, hide evidence behind truncation, misstate freshness, break JSON, or suppress useful fallback results.

Judge wording and layout as output, because agents read both as context: terms an agent already knows rather than backend field names or coined labels, headings that claim exactly what the layout does, and every bound, substitution, omission, or cut stated.

Judge maintainability separately from public output. Look for fewer competing owners, simpler caller contracts, and less repeated work. Keep cohesive workflows and idiomatic code when a rewrite only adds helpers, type indirection, or navigation.

## Keep Boundaries Clear

- Follow the ownership map and settled direction in `docs/IDEAS.md`; do not restate them here.
- Share scalar scanner facts across graph and inspection consumers without retaining native syntax trees between files.
- Change the full public boundary when needed: parser, implementation, renderer, exports, docs, skill, and public tests. The README figures in `docs/images/` draw the evidence stack and `signals` ordering from live data; when a change alters what one shows, recheck the sources its evidence comment lists and redraw it. They show mechanisms, never this repository's counts, scores, or symbol names, which tell a reader nothing about Codemap.
- Keep executable output factual and compact. Put usage in `skills/codemap/SKILL.md`, public behavior in `README.md`, and durable decisions in `docs/IDEAS.md`.

## Log the Work

Keep a concise temporary `LOGBOOK.md` in `.cache/<run>/` of material tasks, expectations, evidence, decisions, results, and limitations, without raw transcripts or repeated probes. A long run outlives its context, and the logbook is what a summarized session resumes from. Keep builds, case outputs, and fixtures beside it, and move durable decisions into `docs/IDEAS.md`.

## Verify and Finish

Test public behavior and lifecycle invariants rather than private helper shape. Run the test suite once before editing and note what already fails: a sandbox can fail tests that start other programs such as `git`, and that note is what tells an environmental failure from a regression. Run formatting, lint, typecheck, focused tests, build, and live commands in proportion to the change, reusing existing proof where it still covers the working tree. Validate changed skills and confirm their examples match the live CLI. Rebuild `dist/` once the change is verified, because the installed command runs it, and when `skills/codemap/` changed, say that installed copies need recopying.

Open the report with the kind of change and the statement it serves, so the owner can audit direction from one line per run. Then report the friction, improvement, changed or preserved contracts, before-and-after evidence, verification, remaining evidence-backed limitation, and the frictions found but left alone. State a leftover friction in `docs/IDEAS.md` only when it is a property of Codemap rather than of one repository. Remove `.cache/<run>/` after retaining useful decisions, leaving `.cache/corpora/` for the next run, and stop when the requested outcome is proven. If no proposed change survives the evidence, report that result.
