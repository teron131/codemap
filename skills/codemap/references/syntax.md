# Syntax Reference

Use `codemap syntax` when the task is an AST-backed operation: rewrite preview, guarded source edit, pattern debugging, recipes, or apply-capable YAML rules. Use `codemap search match`, `search calls`, and `search rule` for read-only structural discovery.

Codemap syntax commands are wrappers over Codemap's shared ast-grep layer. Use pattern arguments first: `replace-call`, `replace`, `rename`, `debug`, and `preview` cover the common operation path without YAML. YAML is the advanced path for relational or transformed rules and guarded fixes. Codemap does not replace the ast-grep language, and it does not manage ast-grep rule projects.

Inside Codemap, ast-grep usage should flow through `codemap.ast_grep`. Use the raw ast-grep CLI only for engine flags, interactive rule authoring, full debug dumps, or behavior Codemap does not expose.

## Default Loop

1. Start with the smallest positive example.
2. Try a read-only `search match` or `search calls` pattern.
3. Use `syntax debug` when the pattern or node kind is unclear.
4. Move to a YAML rule only when pattern arguments cannot express the query, such as `kind`, `has`, `inside`, `all`, `any`, `not`, `precedes`, `follows`, transforms, rewriters, or a reusable `fix`.
5. Run the YAML rule against a small snippet path with `search rule`.
6. Run the same YAML rule against the target source paths.
7. Preview rewrites before applying source writes.

## Structural Search

Use simple patterns for one-node structural matches:

```sh
codemap search match --project-root <path> --lang python --pattern "def $NAME($$$ARGS): $$$BODY" <paths...>
codemap search match --project-root <path> --lang typescript --pattern "function $NAME($$$ARGS) { $$$BODY }" <paths...>
```

Use `--json` when another script or agent needs exact match objects.

## Call Search And Rewrite

Use call wrappers for the repeated pattern `$TARGET($$$ARGS)`:

```sh
codemap search calls --project-root <path> print <paths...>
codemap search calls --project-root <path> console.log <paths...>
codemap syntax replace-call --project-root <path> oldFn newFn <paths...>
codemap syntax replace-call --project-root <path> oldFn newFn <paths...> --apply --yes
```

`search calls` finds call sites: places where a function or method is invoked.

`replace-call` preserves the argument list and only changes the call target.

## Pattern Debugging

Use `syntax debug` for a compact ast-grep parse check before guessing at `kind` names:

```sh
codemap syntax debug --project-root <path> --lang typescript --pattern "class User { constructor() {} }" --format cst
codemap syntax debug --project-root <path> --lang typescript --pattern "class $NAME { $$$BODY }" --format pattern
```

The debug output is intentionally compact. Run raw ast-grep directly only when you need a full CST/AST/S-expression dump.

## Rewrite Preview

Use snippet previews before touching project files:

```sh
codemap syntax preview --project-root <path> --lang typescript --pattern "oldFn($$$ARGS)" --rewrite "newFn($$$ARGS)" --code-file <snippet.ts>
```

Use source-file rewrites only after preview:

```sh
codemap syntax replace --project-root <path> --lang python --pattern "$A == None" --rewrite "$A is None" <paths...>
codemap syntax replace --project-root <path> --lang python --pattern "$A == None" --rewrite "$A is None" <paths...> --apply --yes
```

Omit `--lang` when target file suffixes are enough for Codemap to infer the language. Keep `--lang` for stdin previews, mixed file types, ambiguous suffixes, or language-specific ast-grep patterns.

Rewrite previews print changed-line hunks by default. Add `--full` when the old full rewritten file output is easier to inspect.

Use `rename` for simple identifier renames when syntax positions matter:

```sh
codemap syntax rename --project-root <path> OldName NewName <paths...>
codemap syntax rename --project-root <path> OldName NewName <paths...> --apply --yes
```

For batch codemods, add `--allow-empty` when no matches should be reported but should not fail the whole run.

## YAML Rules

Use YAML rules when simple `pattern` is not enough:

```yaml
id: async-with-await
language: javascript
rule:
  kind: function_declaration
  has:
    pattern: await $EXPR
    stopBy: end
```

Then run it read-only against a small snippet path or the target source paths:

```sh
codemap search rule --project-root <path> --rule async-with-await.yml example.js --json
codemap search rule --project-root <path> --rule async-with-await.yml <paths...>
```

Use `syntax rule --apply --yes` only for YAML rules that include a safe `fix`.

Keep YAML rules outside Codemap when they are project-specific. Codemap should run them, preview them, and apply them with explicit write guards; it should not own their directory layout, lifecycle, or test suite.

## Rule Building Blocks

- `pattern`: direct structural match. Start here.
- `kind`: tree-sitter node kind, useful when text shape is ambiguous.
- `regex`: Rust regex against node text.
- `inside`: target must be inside another matching node.
- `has`: target must contain a matching descendant.
- `precedes` / `follows`: target must be before or after another matching node.
- `all`: every sub-rule must match; use this when metavariable order matters.
- `any`: at least one sub-rule must match.
- `not`: exclude a sub-rule.
- `matches`: reuse a utility rule by id.

For relational rules such as `has` and `inside`, use `stopBy: end` unless you specifically want a narrower search.

## Metavariables

- `$A`: one named AST node.
- `$$A`: one unnamed token.
- `$$$ARGS`: zero or more nodes.
- `$_`: anonymous non-capturing variable.

Metavariables must be their own syntax unit. Patterns like `obj.on$EVENT` or string fragments like `"hello $NAME"` do not work as metavariable captures.

## Recipes

Use recipes for Codemap-standard tasks:

```sh
codemap syntax recipes --project-root <path>
codemap syntax recipe --project-root <path> python-none-comparison <paths...>
codemap syntax recipe --project-root <path> python-none-comparison <paths...> --apply --yes
```

Recipes are for generic workflows. Project-specific migrations belong in YAML rule files.
