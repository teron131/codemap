/** Selects and compresses the public export surfaces that best reveal repository capabilities. */

import { readFileSync } from "node:fs";
import path from "node:path";

import { stringField } from "../../json-utils.js";
import { type FileMetrics, isTestPath } from "../../source/scanner/index.js";
import { compareText, extentSamples, uniqueStrings } from "../../text-utils.js";
import type { ExportSurface } from "../schema.js";
import { isConventionalSurface, type SourcePackage } from "./packages.js";
import type { RelationshipRow } from "./relationships.js";
import { filePreview, type SourceContext } from "./source-context.js";
import type { StructuralSummary } from "./structure.js";

type ExportGroup = {
  origin: string;
  names: string[];
};

type ExportSurfaceCandidate = {
  file: string;
  groups: ExportGroup[];
  declared: boolean;
  fanIn: number;
};

type ExportCapabilityCandidate = {
  label: string;
  origins: Set<string>;
  names: Set<string>;
  fanIn: number;
  implementation: number;
  external: boolean;
};

export function publicExportSurfaces(
  source: SourceContext,
  structural: StructuralSummary,
  relationships: RelationshipRow[],
): ExportSurface[] {
  const declared = new Set(structural.packages.flatMap((sourcePackage) => sourcePackage.surfaces));
  const surfaces = new Set(declared);
  for (const metrics of source.files) {
    if (isConventionalSurface(metrics.relPath)) {
      surfaces.add(metrics.relPath);
    }
  }
  const fanIn = importFanIn(relationships);
  const candidates = [...surfaces]
    .map((file): ExportSurfaceCandidate => ({
      file,
      groups: exportGroups(resolvedExports(source, file, new Set())),
      declared: declared.has(file),
      fanIn: fanIn.get(file) ?? 0,
    }))
    .filter((surface) => surface.groups.length > 0);
  const structuralFocus = exportFocusPaths(structural);
  const fallbackFocus = sampledPackageRoots(structural.packages);
  const focusPaths = structuralFocus.length > 0 ? structuralFocus : fallbackFocus;
  const selectedCandidates = selectExportSurfaceCandidates(
    candidates,
    focusPaths.some((focus) => candidates.some((candidate) => isWithin(candidate.file, focus)))
      ? focusPaths
      : [""],
  );
  return projectExportSurfaces(selectedCandidates, source, fanIn, structural.packages);
}

/** Counts how many current-tree source files import each public module. */
function importFanIn(relationships: RelationshipRow[]): Map<string, number> {
  const importers = new Map<string, Set<string>>();
  for (const row of relationships) {
    const source = stringField(row.source);
    const target = stringField(row.target);
    if (source === null || target === null) {
      continue;
    }
    const importerFiles = importers.get(target) ?? new Set<string>();
    importerFiles.add(source);
    importers.set(target, importerFiles);
  }
  return new Map([...importers].map(([file, importerFiles]) => [file, importerFiles.size]));
}

/** Expands the structural skeleton's counted examples into concrete public-API focus paths. */
function exportFocusPaths(structural: StructuralSummary): string[] {
  const paths: string[] = [];
  for (const signal of structural.signals) {
    paths.push(signal.source);
    for (const target of signal.targets) {
      if (target.count === null) {
        paths.push(target.label);
        continue;
      }
      const parent = target.label.replace(/\/\*$/, "");
      paths.push(...target.examples.map((example) => `${parent}/${example}`));
    }
  }
  paths.push(...structural.outlines.map((outline) => outline.source));
  return uniqueStrings(paths);
}

/** Keeps direct package roots and extent samples from wide sibling package families. */
function sampledPackageRoots(packages: SourcePackage[]): string[] {
  if (packages.length === 0) {
    return [""];
  }
  const roots: string[] = [];
  const families = new Map<string, string[]>();
  for (const sourcePackage of packages) {
    if (!sourcePackage.root) {
      roots.push("");
      continue;
    }
    const parent = path.posix.dirname(sourcePackage.root);
    const members = families.get(parent) ?? [];
    members.push(sourcePackage.root);
    families.set(parent, members);
  }
  for (const [, members] of [...families].sort(([left], [right]) => compareText(left, right))) {
    const sorted = members.sort(compareText);
    roots.push(...extentSamples(sorted));
  }
  return uniqueStrings(roots);
}

/** Chooses role winners within each structural focus instead of enumerating every surface. */
function selectExportSurfaceCandidates(
  candidates: ExportSurfaceCandidate[],
  focusPaths: string[],
): ExportSurfaceCandidate[] {
  const selectedCandidates: ExportSurfaceCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: ExportSurfaceCandidate | undefined): void => {
    if (candidate !== undefined && !seen.has(candidate.file)) {
      seen.add(candidate.file);
      selectedCandidates.push(candidate);
    }
  };
  for (const focus of focusPaths) {
    const scoped = candidates.filter((candidate) => isWithin(candidate.file, focus));
    if (scoped.length === 0) {
      continue;
    }
    add([...scoped].sort((left, right) => compareEntrySurface(left, right, focus))[0]);
    const central = [...scoped].sort(compareCentralSurface)[0];
    if ((central?.fanIn ?? 0) > 0) {
      add(central);
    }
    add(shallowBroadSurface(scoped, focus));
  }
  if (selectedCandidates.length === 0 && candidates.length > 0) {
    add([...candidates].sort((left, right) => compareEntrySurface(left, right, ""))[0]);
    const central = [...candidates].sort(compareCentralSurface)[0];
    if ((central?.fanIn ?? 0) > 0) {
      add(central);
    }
    add(shallowBroadSurface(candidates, ""));
  }
  return selectedCandidates;
}

/** Keeps aggregation near the entry layer rather than a deep utility barrel. */
function shallowBroadSurface(
  candidates: ExportSurfaceCandidate[],
  focus: string,
): ExportSurfaceCandidate | undefined {
  const shallowest = Math.min(
    ...candidates.map((candidate) => relativePathDepth(candidate.file, focus)),
  );
  return candidates
    .filter((candidate) => relativePathDepth(candidate.file, focus) <= shallowest + 1)
    .sort(compareBroadSurface)[0];
}

/** Prefers the shallowest declared surface as the focus's natural entry. */
function compareEntrySurface(
  left: ExportSurfaceCandidate,
  right: ExportSurfaceCandidate,
  focus: string,
): number {
  return (
    relativePathDepth(left.file, focus) - relativePathDepth(right.file, focus) ||
    Number(!isConventionalSurface(left.file)) - Number(!isConventionalSurface(right.file)) ||
    Number(!left.declared) - Number(!right.declared) ||
    compareText(left.file, right.file)
  );
}

/** Prefers the surface imported by the widest set of current-tree files. */
function compareCentralSurface(
  left: ExportSurfaceCandidate,
  right: ExportSurfaceCandidate,
): number {
  return (
    right.fanIn - left.fanIn ||
    Number(!left.declared) - Number(!right.declared) ||
    pathDepth(left.file) - pathDepth(right.file) ||
    compareText(left.file, right.file)
  );
}

/** Prefers the surface aggregating the most distinct defining modules, then public names. */
function compareBroadSurface(left: ExportSurfaceCandidate, right: ExportSurfaceCandidate): number {
  return (
    right.groups.length - left.groups.length ||
    exportNameCount(right) - exportNameCount(left) ||
    Number(!left.declared) - Number(!right.declared) ||
    pathDepth(left.file) - pathDepth(right.file) ||
    compareText(left.file, right.file)
  );
}

/** Counts resolved names only as a tie-break for equally broad origin coverage. */
function exportNameCount(surface: ExportSurfaceCandidate): number {
  return surface.groups.reduce((total, group) => total + group.names.length, 0);
}

/** Measures depth beneath a focus path without treating the filename as a directory. */
function relativePathDepth(file: string, focus: string): number {
  return pathDepth(focus ? path.posix.relative(focus, file) : file);
}

/** Tests whether a source file belongs to one structural or package focus. */
function isWithin(file: string, focus: string): boolean {
  return !focus || file === focus || file.startsWith(`${focus}/`);
}

/** Projects selected surfaces to one directly exposed module level. */
function projectExportSurfaces(
  candidates: ExportSurfaceCandidate[],
  source: SourceContext,
  fanIn: Map<string, number>,
  packages: SourcePackage[],
): ExportSurface[] {
  const seenOrigins = new Set<string>();
  const surfaces: ExportSurface[] = [];
  for (const candidate of candidates) {
    const groups = candidate.groups.filter((group) => {
      if (group.origin === candidate.file || seenOrigins.has(group.origin)) {
        return false;
      }
      seenOrigins.add(group.origin);
      return true;
    });
    const capabilities = immediateExportCapabilities(
      candidate.file,
      groups.filter((group) => group.origin !== candidate.file),
      source,
      fanIn,
      packages,
    );
    surfaces.push({
      file: candidate.file,
      description: filePreview(source, candidate.file),
      capabilities,
    });
  }
  return surfaces;
}

/** Selects directly exposed module groups on the structural Pareto frontier. */
function immediateExportCapabilities(
  surface: string,
  groups: ExportGroup[],
  source: SourceContext,
  fanIn: Map<string, number>,
  packages: SourcePackage[],
): ExportSurface["capabilities"] {
  const candidates = new Map<string, ExportCapabilityCandidate>();
  for (const group of groups) {
    const label = immediateCapabilityLabel(surface, group.origin, source.filePaths, packages);
    if (label === null) {
      continue;
    }
    const existing = candidates.get(label) ?? {
      label,
      origins: new Set<string>(),
      names: new Set<string>(),
      fanIn: 0,
      implementation: 0,
      external: !source.filePaths.has(group.origin),
    };
    existing.origins.add(group.origin);
    for (const name of group.names) {
      existing.names.add(name);
    }
    existing.fanIn = Math.max(existing.fanIn, fanIn.get(group.origin) ?? 0);
    const metrics = source.filesByPath.get(group.origin);
    existing.implementation = Math.max(
      existing.implementation,
      (metrics?.defines ?? 0) + (metrics?.functionSpans.length ?? 0),
    );
    candidates.set(label, existing);
  }
  const capabilityCandidates = [...candidates.values()];
  const definingExports = new Map(
    capabilityCandidates.map((candidate) => [
      candidate,
      candidate.origins.size === 1
        ? roleMatchedExportNames(candidate.label, [...candidate.names])
        : [],
    ]),
  );
  const namedCandidates = capabilityCandidates.filter(
    (candidate) =>
      candidate.origins.size === 1 && (definingExports.get(candidate)?.length ?? 0) > 0,
  );
  const roleOutliers = new Set([
    ...upperOutliers(namedCandidates, (candidate) => candidate.fanIn),
    ...upperOutliers(namedCandidates, (candidate) => candidate.implementation),
  ]);
  const selectedCandidates = capabilityCandidates.filter(
    (candidate) =>
      roleOutliers.has(candidate) ||
      !capabilityCandidates.some(
        (other) =>
          other !== candidate &&
          other.fanIn >= candidate.fanIn &&
          other.origins.size >= candidate.origins.size &&
          other.implementation >= candidate.implementation &&
          (other.fanIn > candidate.fanIn ||
            other.origins.size > candidate.origins.size ||
            other.implementation > candidate.implementation),
      ),
  );
  return selectedCandidates
    .sort(
      (left, right) =>
        Number(left.external) - Number(right.external) ||
        right.fanIn - left.fanIn ||
        right.origins.size - left.origins.size ||
        right.implementation - left.implementation ||
        compareText(left.label, right.label),
    )
    .map((candidate) => ({
      label: candidate.label,
      exports: definingExports.get(candidate) ?? [],
    }));
}

/** Selects only data-derived upper outliers when one metric actually separates peers. */
function upperOutliers<T>(values: T[], read: (value: T) => number): T[] {
  if (values.length < 2) {
    return [];
  }
  const measurements = values.map(read);
  const mean = measurements.reduce((total, value) => total + value, 0) / measurements.length;
  const variance =
    measurements.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (measurements.length - 1);
  const deviation = Math.sqrt(variance);
  if (deviation === 0) {
    return [];
  }
  const threshold = mean + deviation;
  return values.filter((value) => read(value) >= threshold);
}

/** Retains names that uniquely identify a module or strongly match its public role. */
function roleMatchedExportNames(label: string, names: string[]): string[] {
  const publicNames = uniqueStrings(names.filter((name) => name && !name.startsWith("_")));
  if (publicNames.length <= 1) {
    return publicNames;
  }
  const labelTokens = identifierTokens(path.posix.basename(label)).filter(
    (token) => token !== "utils" && token !== "index",
  );
  const exact = publicNames.filter((name) => {
    const nameText = identifierTokens(name).join("");
    const labelText = labelTokens.join("").replace(/s$/, "");
    return nameText.replace(/s$/, "") === labelText;
  });
  if (exact.length > 0) {
    return exact;
  }
  const scored = publicNames.map((name) => {
    const nameTokens = identifierTokens(name);
    const affinity = labelTokens.filter((labelToken) =>
      nameTokens.some((nameToken) => commonPrefixLength(labelToken, nameToken) >= 4),
    ).length;
    return { name, affinity, extraTokens: Math.max(0, nameTokens.length - affinity) };
  });
  const bestAffinity = Math.max(...scored.map((item) => item.affinity));
  if (bestAffinity === 0) {
    return [];
  }
  const mostDirect = scored.filter((item) => item.affinity === bestAffinity);
  const leastExtraTokens = Math.min(...mostDirect.map((item) => item.extraTokens));
  return mostDirect
    .filter((item) => item.extraTokens === leastExtraTokens)
    .map((item) => item.name);
}

/** Splits paths, snake case, and camel case into lowercase comparison terms. */
function identifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Measures shared word stems without adding repository-specific aliases. */
function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

/** Collapses a defining module to one child of its public surface or owning package. */
function immediateCapabilityLabel(
  surface: string,
  origin: string,
  filePaths: Set<string>,
  packages: SourcePackage[],
): string | null {
  if (!filePaths.has(origin)) {
    if (
      origin.startsWith(".") ||
      isTestPath(origin) ||
      /(?:^|\/)(?:test(?:ing)?|tests)(?:\/|$)/i.test(origin)
    ) {
      return null;
    }
    if (origin.startsWith("@/")) {
      return origin.split("/").slice(0, 2).join("/");
    }
    return origin;
  }
  const surfaceRoot = path.posix.dirname(surface);
  if (origin.startsWith(`${surfaceRoot}/`)) {
    const parts = path.posix.relative(surfaceRoot, origin).split("/");
    const semanticIndex = parts[0] === "src" && parts.length > 2 ? 1 : 0;
    const label = parts[semanticIndex] ?? origin;
    return parts.length > semanticIndex + 1 ? label : moduleStem(label);
  }
  const surfacePackage = owningSourcePackage(surface, packages);
  const originPackage = owningSourcePackage(origin, packages);
  if (originPackage !== null && originPackage !== surfacePackage) {
    return path.posix.basename(originPackage.root) || originPackage.names[0] || moduleStem(origin);
  }
  return moduleStem(path.posix.basename(origin));
}

/** Finds the deepest authored package containing one source file. */
function owningSourcePackage(file: string, packages: SourcePackage[]): SourcePackage | null {
  return (
    packages.find((item) => !item.root || file === item.root || file.startsWith(`${item.root}/`)) ??
    null
  );
}

/** Removes source and declaration suffixes from one immediate module label. */
function moduleStem(value: string): string {
  return value.replace(/\.d\.[^.]+$/, "").replace(/\.[^.]+$/, "");
}

/** Groups resolved public names by defining module while preserving discovery order. */
function exportGroups(resolvedNames: Map<string, string>): ExportGroup[] {
  const groups = new Map<string, string[]>();
  for (const [name, origin] of resolvedNames) {
    groups.set(origin, [...(groups.get(origin) ?? []), name]);
  }
  return [...groups].map(([origin, names]) => ({ origin, names }));
}

/** Finds source entry surfaces declared by a root package manifest. */
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
    for (const [name, origin] of pythonSurfaceExports(source, file, metrics)) {
      resolvedNames.set(name, origin);
    }
  }
  for (const reexport of metrics.typescriptReexports) {
    const targets = source.resolver.resolve(path.join(source.root, file), reexport.target);
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

/** Resolves explicit Python package imports and local definitions to their owning modules. */
function pythonSurfaceExports(
  context: SourceContext,
  file: string,
  metrics: FileMetrics,
): Map<string, string> {
  const filePath = path.join(context.root, file);
  const resolvedNames = new Map<string, string>();
  if (metrics.exportedNames.length > 0) {
    for (const name of metrics.exportedNames) {
      resolvedNames.set(name, file);
    }
  }
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

/** Counts non-empty POSIX path segments for export-surface ranking. */
function pathDepth(value: string): number {
  return value.split("/").filter(Boolean).length;
}
