/** Selects and compresses the public export surfaces that best reveal repository capabilities. */

import path from "node:path";

import { isWithinDirectory, pathDepth } from "../../path-utils.js";
import { isTestPath } from "../../source/scanner/index.js";
import { compareText, extentSamples, uniqueStrings } from "../../text-utils.js";
import type { ExposedModule, PublicSurface } from "../schema.js";
import { type ExportGroup, exportGroups } from "./export-resolution.js";
import { isConventionalSurface, type SourcePackage } from "./packages.js";
import type { RelationshipRow } from "./relationships.js";
import { fileDescription, type SourceContext } from "./source-context.js";
import type { StructuralSummary } from "./structure.js";

type SurfaceCandidate = {
  file: string;
  groups: ExportGroup[];
  declared: boolean;
  fanIn: number;
};

type ExposedModuleCandidate = {
  label: string;
  origins: Set<string>;
  names: Set<string>;
  fanIn: number;
  implementation: number;
  external: boolean;
};

/**
 * Selects the public surfaces the summary presents and resolves their directly exposed modules.
 *
 * Structural role targets focus the selection; without them, sampled package roots stand in, and the repository root is the last resort.
 * Each focus contributes at most its entry, most-imported, and broadest surface, so wide workspaces stay bounded without enumerating every barrel.
 */
export function publicExportSurfaces(
  source: SourceContext,
  structural: StructuralSummary,
  relationships: RelationshipRow[],
): PublicSurface[] {
  const declared = new Set(structural.packages.flatMap((sourcePackage) => sourcePackage.surfaces));
  const surfaces = new Set(declared);
  for (const metrics of source.files) {
    if (isConventionalSurface(metrics.relPath)) {
      surfaces.add(metrics.relPath);
    }
  }
  const fanIn = importFanIn(relationships);
  const candidates = [...surfaces]
    .map((file): SurfaceCandidate => ({
      file,
      groups: exportGroups(source, file),
      declared: declared.has(file),
      fanIn: fanIn.get(file) ?? 0,
    }))
    .filter((surface) => surface.groups.length > 0);
  const structuralFocus = exportFocusPaths(structural);
  const fallbackFocus = sampledPackageRoots(structural.packages);
  const focusPaths = structuralFocus.length > 0 ? structuralFocus : fallbackFocus;
  const selectedCandidates = selectExportSurfaceCandidates(
    candidates,
    focusPaths.some((focus) =>
      candidates.some((candidate) => isWithinDirectory(candidate.file, focus)),
    )
      ? focusPaths
      : [""],
  );
  return projectExportSurfaces(selectedCandidates, source, fanIn, structural.packages);
}

/** Counts how many working-tree source files import each public module. */
function importFanIn(relationships: RelationshipRow[]): Map<string, number> {
  const importers = new Map<string, Set<string>>();
  for (const row of relationships) {
    const importerFiles = importers.get(row.target) ?? new Set<string>();
    importerFiles.add(row.source);
    importers.set(row.target, importerFiles);
  }
  return new Map([...importers].map(([file, importerFiles]) => [file, importerFiles.size]));
}

/** Expands the structural skeleton's counted examples into concrete public-API focus paths. */
function exportFocusPaths(structural: StructuralSummary): string[] {
  const paths: string[] = [];
  for (const role of structural.roles) {
    paths.push(role.boundary);
    for (const target of role.related) {
      if (target.count === null) {
        paths.push(target.label);
        continue;
      }
      const parent = target.label.replace(/\/\*$/, "");
      paths.push(...target.examples.map((example) => `${parent}/${example}`));
    }
  }
  paths.push(...structural.outlines.map((outline) => outline.boundary));
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
  candidates: SurfaceCandidate[],
  focusPaths: string[],
): SurfaceCandidate[] {
  const selectedCandidates: SurfaceCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: SurfaceCandidate | undefined): void => {
    if (candidate !== undefined && !seen.has(candidate.file)) {
      seen.add(candidate.file);
      selectedCandidates.push(candidate);
    }
  };
  for (const focus of focusPaths) {
    const scoped = candidates.filter((candidate) => isWithinDirectory(candidate.file, focus));
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
  return selectedCandidates;
}

/** Keeps aggregation near the entry layer rather than a deep utility barrel. */
function shallowBroadSurface(
  candidates: SurfaceCandidate[],
  focus: string,
): SurfaceCandidate | undefined {
  const shallowest = Math.min(
    ...candidates.map((candidate) => relativePathDepth(candidate.file, focus)),
  );
  return candidates
    .filter((candidate) => relativePathDepth(candidate.file, focus) <= shallowest + 1)
    .sort(compareBroadSurface)[0];
}

/** Prefers the shallowest declared surface as the focus's natural entry. */
function compareEntrySurface(
  left: SurfaceCandidate,
  right: SurfaceCandidate,
  focus: string,
): number {
  return (
    relativePathDepth(left.file, focus) - relativePathDepth(right.file, focus) ||
    Number(!isConventionalSurface(left.file)) - Number(!isConventionalSurface(right.file)) ||
    Number(!left.declared) - Number(!right.declared) ||
    compareText(left.file, right.file)
  );
}

/** Prefers the surface imported by the widest set of working-tree files. */
function compareCentralSurface(left: SurfaceCandidate, right: SurfaceCandidate): number {
  return (
    right.fanIn - left.fanIn ||
    Number(!left.declared) - Number(!right.declared) ||
    pathDepth(left.file) - pathDepth(right.file) ||
    compareText(left.file, right.file)
  );
}

/** Prefers the surface aggregating the most distinct defining modules, then public names. */
function compareBroadSurface(left: SurfaceCandidate, right: SurfaceCandidate): number {
  return (
    right.groups.length - left.groups.length ||
    exportNameCount(right) - exportNameCount(left) ||
    Number(!left.declared) - Number(!right.declared) ||
    pathDepth(left.file) - pathDepth(right.file) ||
    compareText(left.file, right.file)
  );
}

/** Counts resolved names only as a tie-break for equally broad origin coverage. */
function exportNameCount(surface: SurfaceCandidate): number {
  return surface.groups.reduce((total, group) => total + group.names.length, 0);
}

function relativePathDepth(file: string, focus: string): number {
  return pathDepth(focus ? path.posix.relative(focus, file) : file);
}

/** Projects selected surfaces to one directly exposed module level; a defining module appears only under the first selected surface exposing it. */
function projectExportSurfaces(
  candidates: SurfaceCandidate[],
  source: SourceContext,
  fanIn: Map<string, number>,
  packages: SourcePackage[],
): PublicSurface[] {
  const seenOrigins = new Set<string>();
  const surfaces: PublicSurface[] = [];
  for (const candidate of candidates) {
    const groups = candidate.groups.filter((group) => {
      if (group.origin === candidate.file || seenOrigins.has(group.origin)) {
        return false;
      }
      seenOrigins.add(group.origin);
      return true;
    });
    surfaces.push({
      file: candidate.file,
      description: fileDescription(source, candidate.file),
      modules: exposedModules(candidate.file, groups, source, fanIn, packages),
    });
  }
  return surfaces;
}

/** Selects directly exposed module groups on the structural Pareto frontier. */
function exposedModules(
  surface: string,
  groups: ExportGroup[],
  source: SourceContext,
  fanIn: Map<string, number>,
  packages: SourcePackage[],
): ExposedModule[] {
  const candidates = new Map<string, ExposedModuleCandidate>();
  for (const group of groups) {
    const label = exposedModuleLabel(surface, group.origin, source.filePaths, packages);
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
  const moduleCandidates = [...candidates.values()];
  const definingExports = new Map(
    moduleCandidates.map((candidate) => [
      candidate,
      candidate.origins.size === 1
        ? roleMatchedExportNames(candidate.label, [...candidate.names])
        : [],
    ]),
  );
  const namedCandidates = moduleCandidates.filter(
    (candidate) =>
      candidate.origins.size === 1 && (definingExports.get(candidate)?.length ?? 0) > 0,
  );
  const roleOutliers = new Set([
    ...upperOutliers(namedCandidates, (candidate) => candidate.fanIn),
    ...upperOutliers(namedCandidates, (candidate) => candidate.implementation),
  ]);
  const selectedCandidates = moduleCandidates.filter(
    (candidate) =>
      roleOutliers.has(candidate) ||
      !moduleCandidates.some(
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

/** Selects values at least one sample standard deviation above the mean, and none when every value is equal. */
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

/** Splits paths, snake case, and camel case into lowercase comparison terms: `src/repo_map/buildSummary` → `src`, `repo`, `map`, `build`, `summary`. */
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

/** Collapses a defining module to one child of its public surface or owning package: from `src/index.ts`, `src/search/source.ts` → `search` and `src/cli.ts` → `cli`. Unresolved relative and test origins yield null. */
function exposedModuleLabel(
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

/** Finds the deepest authored package containing one source file, relying on `packages` arriving deepest first. */
function owningSourcePackage(file: string, packages: SourcePackage[]): SourcePackage | null {
  return packages.find((item) => isWithinDirectory(file, item.root)) ?? null;
}

/** Removes source and declaration suffixes from one immediate module label. */
function moduleStem(value: string): string {
  return value.replace(/\.d\.[^.]+$/, "").replace(/\.[^.]+$/, "");
}
