/** Resolves each name a surface file exports to the module that defines it, following TypeScript re-exports and Python package imports. */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SourceContext } from "./source-context.js";

export type ExportGroup = {
  origin: string;
  names: string[];
};

/** Groups the names `file` exports by their defining module, in discovery order. */
export function exportGroups(source: SourceContext, file: string): ExportGroup[] {
  const resolvedNames = resolvedExports(source, file, new Set());
  const groups = new Map<string, string[]>();
  for (const [name, origin] of resolvedNames) {
    groups.set(origin, [...(groups.get(origin) ?? []), name]);
  }
  return [...groups].map(([origin, names]) => ({ origin, names }));
}

/** Maps each name `file` exports to its defining module, following resolvable re-exports with `visiting` guarding cycles. A named re-export from an unresolvable specifier maps to the specifier itself. */
function resolvedExports(
  source: SourceContext,
  file: string,
  visiting: Set<string>,
): Map<string, string> {
  if (visiting.has(file)) {
    return new Map();
  }
  const metrics = source.filesByPath.get(file);
  if (metrics === undefined) {
    return new Map();
  }
  visiting.add(file);
  const resolvedNames = new Map<string, string>();
  const namedReexports = new Set(
    metrics.typescriptReexports.flatMap(
      (reexport) => reexport.bindings?.map((binding) => binding.exported) ?? [],
    ),
  );
  for (const name of metrics.exportedNames) {
    if (!namedReexports.has(name)) {
      resolvedNames.set(name, file);
    }
  }
  if (file.endsWith("__init__.py")) {
    for (const [name, origin] of pythonSurfaceExports(source, file)) {
      resolvedNames.set(name, origin);
    }
  }
  for (const reexport of metrics.typescriptReexports) {
    const targets = source.resolver.resolveTypescript(
      path.join(source.root, file),
      reexport.target,
    );
    if (targets.length === 0 && reexport.bindings !== null) {
      for (const binding of reexport.bindings) {
        resolvedNames.set(binding.exported, reexport.target);
      }
      continue;
    }
    for (const target of targets) {
      const nested = resolvedExports(source, target, visiting);
      if (reexport.bindings === null) {
        for (const [name, origin] of nested) {
          if (!resolvedNames.has(name)) {
            resolvedNames.set(name, origin);
          }
        }
        continue;
      }
      for (const binding of reexport.bindings) {
        const origin =
          binding.imported === null ? target : (nested.get(binding.imported) ?? target);
        resolvedNames.set(binding.exported, origin);
      }
    }
  }
  visiting.delete(file);
  return resolvedNames;
}

/** Resolves explicit Python package imports and local definitions to their owning modules by line regex, so only single-line relative `from .x import a, b` statements count and parenthesized imports are skipped. */
function pythonSurfaceExports(context: SourceContext, file: string): Map<string, string> {
  const filePath = path.join(context.root, file);
  const resolvedNames = new Map<string, string>();
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return resolvedNames;
  }
  for (const match of source.matchAll(/^\s*from\s+(\.[\w.]*)\s+import\s+([^\n]+)/gm)) {
    const origin = pythonSurfaceImportOrigin(file, match[1] ?? "", context.filePaths);
    if (origin === null || (match[2] ?? "").trim().startsWith("(")) {
      continue;
    }
    for (const item of (match[2] ?? "").split(",")) {
      const bindingParts = item.trim().split(/\s+as\s+/);
      const name = (bindingParts[1] ?? bindingParts[0] ?? "").trim();
      if (name && name !== "*" && !name.startsWith("_")) {
        resolvedNames.set(name, origin);
      }
    }
  }
  for (const match of source.matchAll(/^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/gm)) {
    const name = match[1] ?? "";
    if (name && !name.startsWith("_")) {
      resolvedNames.set(name, file);
    }
  }
  return resolvedNames;
}

/** Resolves one relative Python import module to an authored source file. */
function pythonSurfaceImportOrigin(
  file: string,
  rawModule: string,
  filePaths: Set<string>,
): string | null {
  const level = rawModule.match(/^\.+/)?.[0].length ?? 0;
  if (level === 0) {
    return null;
  }
  const packageParts = path.posix.dirname(file).split("/").filter(Boolean);
  const moduleParts = rawModule.slice(level).split(".").filter(Boolean);
  const baseParts = packageParts.slice(0, Math.max(0, packageParts.length - level + 1));
  const modulePath = [...baseParts, ...moduleParts].join("/");
  return (
    [`${modulePath}.py`, `${modulePath}/__init__.py`].find((item) => filePaths.has(item)) ?? null
  );
}
