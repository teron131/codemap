/** Resolves Python import statements to project-relative source paths. */
import path from "node:path";

import type { FileMetrics } from "../scanner/metrics.js";

type PythonModuleIndex = Map<string, string[]>;

/** `from pkg import name` points at the `pkg.name` submodule when any imported name is one, and at `pkg` otherwise. */
export function pythonImportTargets(
  metrics: FileMetrics,
  filePaths: Set<string>,
  moduleIndex: PythonModuleIndex,
): string[] {
  const targets = new Set<string>();
  const relPath = metrics.relPath;
  const packageParts = path.posix.dirname(toPosixPath(relPath)).split("/");
  for (const statement of metrics.pythonImports) {
    if (statement.kind === "import") {
      for (const name of statement.names) {
        for (const target of targetsForModule(name.split("."))) {
          targets.add(target);
        }
      }
      continue;
    }
    const moduleParts = statement.module ? statement.module.split(".") : [];
    const baseParts =
      statement.level > 0
        ? packageParts
            .slice(0, Math.max(0, packageParts.length - statement.level + 1))
            .filter((part) => part && part !== ".")
        : [];
    const baseModuleParts = [...baseParts, ...moduleParts.filter(Boolean)];
    const moduleTargets = targetsForModule(baseModuleParts);
    const importedFromTargets: string[] = [];
    for (const name of statement.names) {
      if (name === "*") {
        continue;
      }
      importedFromTargets.push(...targetsForModule([...baseModuleParts, name]));
    }
    const chosenTargets = importedFromTargets.length === 0 ? moduleTargets : importedFromTargets;
    for (const target of chosenTargets) {
      targets.add(target);
    }
  }
  return [...targets].sort();

  function targetsForModule(parts: string[]): string[] {
    return resolvePythonModule(parts.filter(Boolean), filePaths, moduleIndex);
  }
}

/** Keys each file under a top-level package by its dotted module name, as in `src/pkg/sub/mod.py` → `pkg.sub.mod`, so src-layout imports resolve. */
export function pythonModuleIndex(filePaths: Set<string>): PythonModuleIndex {
  const initDirs = new Set(
    [...filePaths]
      .filter((filePath) => path.posix.basename(filePath) === "__init__.py")
      .map((filePath) => path.posix.dirname(toPosixPath(filePath))),
  );
  const topPackageDirs = [...initDirs]
    .filter((dirPath) => !initDirs.has(path.posix.dirname(dirPath)))
    .sort();
  const modules: PythonModuleIndex = new Map();
  for (const relPath of [...filePaths].filter((filePath) => filePath.endsWith(".py")).sort()) {
    for (const packageDir of topPackageDirs) {
      if (relPath !== `${packageDir}/__init__.py` && !relPath.startsWith(`${packageDir}/`)) {
        continue;
      }
      const packageName = path.posix.basename(packageDir);
      const inner = stripSuffix(path.posix.relative(packageDir, toPosixPath(relPath)), ".py").split(
        "/",
      );
      let moduleParts = [packageName, ...inner];
      if (moduleParts.at(-1) === "__init__") {
        moduleParts = moduleParts.slice(0, -1);
      }
      if (moduleParts.length > 0) {
        const key = moduleKey(moduleParts);
        modules.set(key, [...(modules.get(key) ?? []), relPath]);
      }
      break;
    }
  }
  return modules;
}

/** Root-relative module paths win over the package index. */
function resolvePythonModule(
  parts: string[],
  filePaths: Set<string>,
  moduleIndex: PythonModuleIndex,
): string[] {
  if (parts.length === 0) {
    return [];
  }
  const modulePath = parts.join("/");
  const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`];
  const exactMatches = candidates.filter((candidate) => filePaths.has(candidate));
  if (exactMatches.length > 0) {
    return exactMatches;
  }
  return moduleIndex.get(moduleKey(parts)) ?? [];
}

function moduleKey(parts: string[]): string {
  return parts.join("\0");
}

function stripSuffix(value: string, suffix: string): string {
  return suffix && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
