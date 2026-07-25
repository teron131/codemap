/** Resolves TypeScript-family imports, including TSX and JSX files. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { TYPESCRIPT_SUFFIXES } from "../scanner/constants.js";
import type { FileMetrics } from "../scanner/metrics.js";

export const TYPESCRIPT_RESOLUTION_SUFFIXES = [
  "",
  ...TYPESCRIPT_SUFFIXES,
  ...[...TYPESCRIPT_SUFFIXES].map((suffix) => `/index${suffix}`),
];

export type TypeScriptPathAlias = [string, string];

/** Resolves TS/JS import specifiers with project files, aliases, and a cache. */
export class TypeScriptResolver {
  root: string;
  rootPath: string;
  filePaths: Set<string>;
  aliases: TypeScriptPathAlias[];
  cache: Map<string, string[]>;

  /** Stores project files and tsconfig aliases for repeated import resolution. */
  constructor(root: string, filePaths: Set<string>, aliases: TypeScriptPathAlias[]) {
    this.root = path.resolve(root);
    this.rootPath = this.root;
    this.filePaths = filePaths;
    this.aliases = aliases;
    this.cache = new Map();
  }

  /** Resolves a TypeScript import specifier to project-relative target files. */
  resolve(filePath: string, specifier: string): string[] {
    const key = `${path.dirname(filePath)}\0${specifier}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.resolveUncached(filePath, specifier));
    }
    return [...(this.cache.get(key) ?? [])];
  }

  /** Expands a specifier and tests every source/index suffix candidate. */
  resolveUncached(filePath: string, specifier: string): string[] {
    const bases = this.candidateBases(filePath, specifier);
    if (bases.length === 0) {
      return [];
    }
    const targets: string[] = [];
    for (const base of bases) {
      for (const suffix of TYPESCRIPT_RESOLUTION_SUFFIXES) {
        const candidate = suffix ? `${base}${suffix}` : base;
        const relCandidate = this.relativeCandidate(candidate);
        if (this.filePaths.has(relCandidate)) {
          targets.push(relCandidate);
        }
      }
    }
    return targets;
  }

  /** Expands relative paths and tsconfig aliases into possible import bases. */
  candidateBases(filePath: string, specifier: string): string[] {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return typescriptSourceBases(path.join(path.dirname(filePath), specifier));
    }
    const bases: string[] = [];
    for (const [pattern, target] of this.aliases) {
      const matched = applyTypescriptAlias(pattern, target, specifier);
      if (matched) {
        bases.push(...typescriptSourceBases(path.join(this.root, matched)));
      }
    }
    return bases;
  }

  /** Converts a candidate path into an in-project relative path. */
  relativeCandidate(candidate: string): string {
    const normalized = path.normalize(candidate);
    const relCandidate = path.relative(this.rootPath, normalized);
    if (relCandidate === ".." || relCandidate.startsWith(`..${path.sep}`)) {
      return "";
    }
    return toPosixPath(relCandidate);
  }
}

/** Resolves the import and re-export targets recorded by scanner metrics. */
export function typescriptImportTargets(
  filePath: string,
  metrics: FileMetrics,
  resolver: TypeScriptResolver,
): string[] {
  const targets = new Set<string>();
  for (const specifier of [
    ...metrics.typescriptImportTargets,
    ...metrics.typescriptReexportTargets,
  ]) {
    for (const target of resolver.resolve(filePath, specifier)) {
      targets.add(target);
    }
  }
  return [...targets].sort();
}

/** Reads tsconfig path aliases for TypeScript import resolution. */
export function typescriptPathAliases(root: string): TypeScriptPathAlias[] {
  const tsconfig = path.join(root, "tsconfig.json");
  try {
    const payload = JSON.parse(readFileSync(tsconfig, "utf8"));
    const paths = payload?.compilerOptions?.paths;
    if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
      return [];
    }
    const aliases: TypeScriptPathAlias[] = [];
    for (const [pattern, targets] of Object.entries(paths)) {
      if (typeof pattern !== "string" || !Array.isArray(targets)) {
        continue;
      }
      for (const target of targets) {
        if (typeof target === "string") {
          aliases.push([pattern, target]);
        }
      }
    }
    return aliases;
  } catch {
    return [];
  }
}

/** Expands emitted JavaScript specifiers to possible source bases. */
export function typescriptSourceBases(base: string): string[] {
  const bases = [base];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(base))) {
    bases.push(stripSuffix(base, path.extname(base)));
  }
  return bases;
}

/** Applies a single tsconfig path alias pattern to an import specifier. */
export function applyTypescriptAlias(
  pattern: string,
  target: string,
  specifier: string,
): string | null {
  if (!pattern.includes("*")) {
    return specifier === pattern ? target : null;
  }
  const [prefix = "", suffix = ""] = pattern.split("*", 2);
  if (!specifier.startsWith(prefix) || (suffix && !specifier.endsWith(suffix))) {
    return null;
  }
  const end = suffix ? specifier.length - suffix.length : specifier.length;
  const captured = specifier.slice(prefix.length, end);
  return target.replace("*", captured);
}

/** Removes a matched TypeScript path suffix while resolving imports. */
function stripSuffix(value: string, suffix: string): string {
  return suffix && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

/** Normalizes TypeScript import paths to slash-separated project keys. */
function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
