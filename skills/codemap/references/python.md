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

Use default `search` for concepts like `artifacts update`, `python imports`, `render inspection`, or specific function/class names.

Use `search match` when the query is a Python syntax pattern:

```sh
codemap search match --project-root <path> --lang python --pattern "def $NAME($$$ARGS): $$$BODY" <paths...>
```

Use `search rule` for read-only saved ast-grep rules with kind, regex, relational, or reusable constraints. Use `syntax rule --apply --yes` only when applying a safe fix.

Use `search --graph` only when the search result itself needs derived relationship context.

Use `inspect` on the path returned by search when you need the focused neighborhood. The target card shows incoming/outgoing imports, contained symbols, calls, long functions, and file profile hints.

Use `signals` when looking for compact refactor evidence or high-signal files, but do not treat it as a lint report. Use `signals top` for triage, `signals functions` for long functions and broad function names, `signals variables` for least-used definitions and broad name pools, and `signals files` when you need dense file profile rows directly.
