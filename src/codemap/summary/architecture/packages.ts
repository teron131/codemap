/** Discovers authored package boundaries, identities, dependencies, and declared surfaces. */

import { readFileSync } from "node:fs";
import path from "node:path";

import { recordValue, stringField } from "../../json-utils.js";
import { discoverFiles, isGeneratedPath, isTestPath } from "../../source/scanner/index.js";
import { compareText, uniqueStrings } from "../../text-utils.js";
import type { SourceContext } from "./source-context.js";

export type SourcePackage = {
  root: string;
  names: string[];
  dependencies: string[];
  surfaces: string[];
  declared: boolean;
};

/** Recursively collects concrete string targets from manifest entrypoint objects. */
function collectManifestTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string" && !value.includes("*")) {
    targets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectManifestTargets(item, targets);
    }
    return;
  }
  for (const item of Object.values(recordValue(value))) {
    collectManifestTargets(item, targets);
  }
}

/** Maps emitted manifest targets back to plausible current-tree source files. */
function manifestSourceCandidates(target: string): string[] {
  const normalized = target.replace(/^\.\//, "").split(path.sep).join("/");
  const sourceBase = normalized.replace(/^(?:dist|build|lib)\//, "src/");
  const bases = uniqueStrings([normalized, sourceBase]);
  const candidates: string[] = [];
  for (const base of bases) {
    const withoutDeclaration = base.replace(/\.d\.ts$/, "");
    const withoutSuffix = withoutDeclaration.replace(/\.(?:[cm]?[jt]sx?|py)$/, "");
    candidates.push(base);
    for (const suffix of [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".py"]) {
      candidates.push(`${withoutSuffix}${suffix}`);
      candidates.push(`${withoutSuffix}/index${suffix}`);
    }
  }
  return uniqueStrings(candidates);
}

/** Recognizes intentional barrel/package files rather than every internal export declaration. */
export function isConventionalSurface(filePath: string): boolean {
  const name = path.posix.basename(filePath).toLowerCase();
  if (name === "__init__.py") {
    return true;
  }
  return /^index\.(?:[cm]?[jt]sx?)$/.test(name);
}

/** Reads authored package boundaries and their declared in-repository dependencies. */
export function sourcePackages(source: SourceContext): SourcePackage[] {
  const packages = new Map<string, SourcePackage>();
  for (const manifestPath of discoverFiles(source.root)) {
    const name = path.basename(manifestPath);
    if (name !== "package.json" && name !== "pyproject.toml") {
      continue;
    }
    const relative = path.relative(source.root, manifestPath).split(path.sep).join("/");
    if (isTestPath(relative) || isGeneratedPath(relative) || nonProductManifestPath(relative)) {
      continue;
    }
    const root = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative);
    if (
      root &&
      ![...source.filePaths].some((file) => file === root || file.startsWith(`${root}/`))
    ) {
      continue;
    }
    const manifest = sourcePackageManifest(manifestPath, name);
    if (manifest === null) {
      continue;
    }
    const existing = packages.get(root);
    const surfaces = manifestSurfacePaths(root, manifest.surfaceTargets, source.filePaths);
    packages.set(root, {
      root,
      names: uniqueStrings([
        ...(existing?.names ?? []),
        ...(manifest.name === null ? [] : [manifest.name]),
      ]),
      dependencies: uniqueStrings([...(existing?.dependencies ?? []), ...manifest.dependencies]),
      surfaces: uniqueStrings([...(existing?.surfaces ?? []), ...surfaces]),
      declared: existing?.declared === true || manifest.declared,
    });
  }
  const discoveredPackages = [...packages.values()];
  const productPackages =
    discoveredPackages.length > 1
      ? discoveredPackages.filter((item) => item.root !== "" || item.declared)
      : discoveredPackages;
  return productPackages.sort(
    (left, right) =>
      pathDepth(right.root) - pathDepth(left.root) || compareText(left.root, right.root),
  );
}

/** Parses only package identity, dependencies, and entry-surface presence from one manifest. */
function sourcePackageManifest(
  manifestPath: string,
  manifestFileName: string,
): {
  name: string | null;
  dependencies: string[];
  surfaceTargets: string[];
  declared: boolean;
} | null {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
  if (manifestFileName === "package.json") {
    try {
      const manifest = recordValue(JSON.parse(text));
      const name = stringField(manifest.name);
      const dependencies = [
        ...Object.keys(recordValue(manifest.dependencies)),
        ...Object.keys(recordValue(manifest.optionalDependencies)),
        ...Object.keys(recordValue(manifest.peerDependencies)),
      ];
      const surfaceTargets = new Set<string>();
      for (const value of [
        manifest.bin,
        manifest.main,
        manifest.module,
        manifest.types,
        manifest.exports,
      ]) {
        collectManifestTargets(value, surfaceTargets);
      }
      return {
        name,
        dependencies: uniqueStrings(dependencies),
        surfaceTargets: [...surfaceTargets],
        declared: [manifest.bin, manifest.main, manifest.module, manifest.exports].some(
          (value) => value !== undefined,
        ),
      };
    } catch {
      return null;
    }
  }
  const projectHeading = /^\[project\]\s*$/m.exec(text);
  const afterProject =
    projectHeading === null ? "" : text.slice(projectHeading.index + projectHeading[0].length);
  const nextSection = afterProject.search(/^\[/m);
  const projectBlock = nextSection < 0 ? afterProject : afterProject.slice(0, nextSection);
  const name = /^name\s*=\s*["']([^"']+)/m.exec(projectBlock)?.[1] ?? null;
  if (name === null) {
    return null;
  }
  const dependencyBlock = /^dependencies\s*=\s*\[([\s\S]*?)^\]/m.exec(projectBlock)?.[1] ?? "";
  const dependencies = [...dependencyBlock.matchAll(/["']([A-Za-z0-9_.-]+)/g)].map(
    (match) => match[1] ?? "",
  );
  return {
    name,
    dependencies: uniqueStrings(dependencies.filter(Boolean)),
    surfaceTargets: [],
    declared: /^\[project\.(?:scripts|entry-points)(?:\.|\])/m.test(text),
  };
}

/** Resolves emitted manifest targets to current-tree source paths within one package root. */
function manifestSurfacePaths(root: string, targets: string[], filePaths: Set<string>): string[] {
  return targets.flatMap((target) => {
    const candidate = manifestSourceCandidates(target)
      .map((sourcePath) => (root ? `${root}/${sourcePath}` : sourcePath))
      .find((sourcePath) => filePaths.has(sourcePath));
    return candidate === undefined ? [] : [candidate];
  });
}

/** Excludes manifest collections that describe examples, docs, scripts, or internal test tooling. */
function nonProductManifestPath(file: string): boolean {
  return file
    .split("/")
    .slice(0, -1)
    .some((part) =>
      /^(?:benchmarks?|dependency_range_tests|docs?|environment_tests|examples?|fixtures?|internal|scripts?|templates?|tests?(?:[-_].*)?|website)$/i.test(
        part,
      ),
    );
}

/** Counts non-empty POSIX path segments for package specificity ordering. */
function pathDepth(value: string): number {
  return value.split("/").filter(Boolean).length;
}
