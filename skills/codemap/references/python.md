# Python Reference

Use Codemap as a Python-first syntax-aware source inspection tool. It is not a typechecker or compiler model; use it to orient around imports, symbols, paths, usage signals, and likely workflow hubs.

## Python Mapping Strengths

Codemap extracts Python files with syntax-level evidence:

- Relative imports such as `from .helpers import name`.
- Absolute project imports such as `import pkg.module`, `from pkg import module`, and `from pkg.module import symbol`.
- Functions, classes, and file containment.
- Same-file call-ish edges when the callee resolves to emitted function nodes.
- Docstring/comment signals and file-level summaries.

Treat these as relationship leads. Verify behavior with focused file reads and tests before changing code.

## Workflow

Start with `summary` to find repo inventory, intent clues, entrypoints, and hubs. Good starting targets are `__main__.py`, `cli.py`, `main.py`, `app.py`, dense files, and files with high import fan-in/fan-out.

Use default `search` for concepts like `python imports`, `render inspection`, `entrypoint discovery`, or specific function/class names.

Default search includes built-in Python definition matching plus exact `rg` text fallback. `search calls` uses the ast-grep CLI when installed; without it, rows are explicitly labeled `[regex]` and should be treated as approximate because comments and strings can match.

A simple Python `search match` requires an installed ast-grep CLI:

```sh
codemap search match --project-root <path> --lang python --pattern "def $NAME($$$ARGS): $$$BODY" <paths...>
```

Run raw ast-grep for Python kind, regex, relational, reusable, rewrite, or fix rules; Codemap’s built-in NAPI language set does not include Python.

Use `search --graph` only when the search result itself needs derived relationship context.

Use `inspect` on the path returned by search when you need incoming/outgoing imports, contained symbols, calls, long functions, source metrics, and file profile hints.

Use default `signals` for at most twelve function-pressure, small-function, and long-name rows. The mention count is lexical rather than compiler-resolved; verify apparent dead code with `search`, source reads, and tests. Use explicit `signals functions`, `signals variables`, or `signals files` only when the compact evidence points there.
