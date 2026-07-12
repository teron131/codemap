/** Defines CLI behavior for focused source inspection targets. */
import { statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import {
	codebaseMemoryInspect,
	renderCodebaseMemoryInspect,
} from "../codebase-memory/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "../rendering/index.js";
import { runScan, type ScanEntry } from "../source/extraction/index.js";
import { structureForFile } from "../source/extraction/structure.js";
import type { GraphPayload } from "../source/graph/index.js";
import {
	appendLikelyEntryContext,
	currentTreeInspectGraph,
	type LikelyEntryContext,
	renderInspection,
} from "../source/inspection/index.js";
import { metricsForFiles } from "../source/inspection/metrics.js";
import {
	appendFileProfile,
	fileMetricsForPath,
} from "../source/inspection/profiles.js";
import { type FileMetrics, scanFile } from "../source/scanner/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";
import { buildSummaryGraphFromScan } from "./summary.js";

type InspectOptions = {
	projectRoot?: string;
	limit?: string | number;
	backend?: boolean;
	local?: boolean;
};

type RootOptions = {
	projectRoot?: string;
};

type InspectTargetKind = "directory" | "file";

/** Registers the inspect command and its output options. */
export function addInspectParser(program: Command): void {
	const inspect = program
		.command("inspect")
		.description(
			"Inspect one known file, function, class, variable, or symbol target.",
		)
		.argument("<target>")
		.option(
			"--limit <count>",
			"Maximum rows per section.",
			parseIntegerOption,
			8,
		)
		.option("--backend", "Use Codebase Memory backend inspection only.")
		.option("--local", "Use current-tree local inspection only.")
		.action((target: string, options: InspectOptions) => {
			const exitCode = commandInspect(
				target,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(inspect);
}

/** Runs focused inspection for a path, symbol, or directory target. */
export function commandInspect(
	target: string,
	options: InspectOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const limit = inspectLimit(options.limit);
	if (options.backend && options.local) {
		console.log("Choose only one inspect lane: --backend or --local.");
		return 2;
	}
	if (!options.backend && inspectPathTargetKind(root, target) !== null) {
		const inspection = renderCurrentTreeInspection(root, target, { limit });
		if (inspection !== null) {
			console.log(inspection);
			return 0;
		}
	}
	if (!options.local) {
		const backendInspection = codebaseMemoryInspect(root, target, limit);
		if (backendInspection !== null) {
			console.log(renderCodebaseMemoryInspect(backendInspection, { limit }));
			return 0;
		}
	}
	if (options.backend) {
		console.log(`No backend match: ${target}`);
		console.log("Backend: Codebase Memory");
		return 1;
	}
	const inspection = renderCurrentTreeInspection(root, target, { limit });
	if (inspection === null) {
		console.log(`No match: ${target}`);
		console.log(
			`Run: codemap search --project-root ${root} ${pythonRepr(target)}`,
		);
		return 1;
	}
	console.log(inspection);
	return 0;
}

/** Runs the current-tree inspect workflow without printing command fallback text. */
function renderCurrentTreeInspection(
	root: string,
	target: string,
	{ limit }: { limit: number },
): string | null {
	const pathTargetKind = inspectPathTargetKind(root, target);
	let pathTargetScan: ReturnType<typeof runScan> | null = null;
	if (pathTargetKind !== null) {
		const scan = runScan(root);
		pathTargetScan = scan;
		if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
			const likelyEntries = likelyEntryContextByFile(
				buildSummaryGraphFromScan(root, scan),
			);
			const inspection =
				pathTargetKind === "directory"
					? renderLightweightDirectoryInspection(root, target, scan.files, {
							limit,
						})
					: renderLightweightFileInspection(root, target, scan.files, {
							limit,
							likelyEntries,
						});
			if (inspection !== null) {
				return inspection;
			}
		}
	}
	const [graph, metrics] = currentTreeInspectGraph(
		root,
		target,
		pathTargetScan,
	);
	const likelyEntries = likelyEntryContextByFile(graph);
	const inspection = renderInspection(root, graph, metrics, target, {
		limit,
		likelyEntries,
	});
	if (inspection === null) {
		return null;
	}
	return inspection;
}

/** Classifies a target that directly names a filesystem path. */
function inspectPathTargetKind(
	root: string,
	target: string,
): InspectTargetKind | null {
	const targetPath = path.resolve(root, target);
	try {
		const stats = statSync(targetPath);
		if (stats.isDirectory()) {
			return "directory";
		}
		return stats.isFile() ? "file" : null;
	} catch {
		return null;
	}
}

/** Renders file inspection from one target file when whole-repo graphing is too large. */
function renderLightweightFileInspection(
	root: string,
	target: string,
	files: ScanEntry[],
	{
		limit,
		likelyEntries,
	}: { limit: number; likelyEntries: Record<string, LikelyEntryContext> },
): string | null {
	const relTarget = directoryRelTarget(root, target);
	const scanEntry = files.find((entry) => entry.path === relTarget);
	if (scanEntry === undefined) {
		return null;
	}
	const filePath = path.join(root, relTarget);
	const metrics = scanFile(filePath, { displayRoot: root });
	const structure = structureForFile(root, scanEntry, {
		metricsByPath: { [relTarget]: metrics },
	});
	const functionCount =
		structure?.functions.length ?? metrics.functionSpans.length;
	const classCount = structure?.classes.length ?? 0;
	const lines = [
		`# ${relTarget}`,
		"",
		`${relTarget}: ${scanEntry.fileCategory} file in ${scanEntry.language}; ${scanEntry.sizeLines} lines; ${functionCount} functions, ${classCount} classes.`,
		`Fallback: detailed graph skipped above ${DETAILED_ANALYSIS_FILE_LIMIT} files; incoming imports not computed.`,
	];
	appendLikelyEntryContext(lines, likelyEntries[relTarget]);
	appendFileImportSpecs(lines, metrics, { limit });
	appendFileContains(lines, relTarget, structure, { limit });
	const fileMetrics = metricsForFiles(root, [scanEntry], {
		[relTarget]: metrics,
	});
	appendFileProfile(lines, fileMetricsForPath(fileMetrics, relTarget), {
		limit,
	});
	return lines.join("\n").trim();
}

/** Builds likely-entry context keyed by source file path from graph evidence. */
function likelyEntryContextByFile(
	graph: GraphPayload,
): Record<string, LikelyEntryContext> {
	const importMapEvidence = recordValue(graph.evidence.importMap);
	const entries =
		importMapEvidence.mode === "lightweight-summary"
			? buildPathRankedLikelyEntries(graph.nodes)
			: buildLikelyEntries(graph.nodes, graph.edges);
	const byFile: Record<string, LikelyEntryContext> = {};
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") {
			continue;
		}
		const row = entry as Record<string, unknown>;
		const filePath = String(row.title ?? "");
		if (!filePath) {
			continue;
		}
		byFile[filePath] = {
			role: row.role,
			reason: row.reason,
			description: row.description,
		};
	}
	return byFile;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Renders directory inspection from scan data when graph analysis is skipped. */
function renderLightweightDirectoryInspection(
	root: string,
	target: string,
	files: ScanEntry[],
	{ limit }: { limit: number },
): string {
	const relTarget = directoryRelTarget(root, target);
	const rows =
		relTarget === "."
			? files
			: files.filter((entry) => entry.path.startsWith(`${relTarget}/`));
	const title = relTarget === "." ? "." : relTarget.replace(/\/+$/, "");
	const lines = [
		`# ${title}/`,
		"",
		`Directory profile: ${rows.length} scanned files.`,
		`Fallback: detailed graph skipped above ${DETAILED_ANALYSIS_FILE_LIMIT} files.`,
	];
	const denseRows = rows
		.slice()
		.sort(
			(left, right) =>
				-Number(left.sizeLines ?? 0) - -Number(right.sizeLines ?? 0) ||
				compareText(left.path, right.path),
		)
		.slice(0, limit);
	if (denseRows.length > 0) {
		lines.push("");
		lines.push("## Largest Files");
		for (const item of denseRows) {
			lines.push(
				`- ${item.path}: ${item.sizeLines} lines, ${item.language}, ${item.fileCategory}`,
			);
		}
		if (rows.length > denseRows.length) {
			lines.push("- ...");
		}
	}
	return lines.join("\n").trim();
}

/** Appends raw imports seen in the inspected file. */
function appendFileImportSpecs(
	lines: string[],
	metrics: FileMetrics,
	{ limit }: { limit: number },
): void {
	const imports = uniqueRows([
		...metrics.pyImportTargets,
		...metrics.typescriptImportTargets,
		...metrics.typescriptReexportTargets.map((target) => `re-export ${target}`),
	]);
	if (imports.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Imports From File");
	for (const item of imports.slice(0, limit)) {
		lines.push(`- ${item}`);
	}
	appendLimitMarker(lines, imports.length, limit);
}

/** Appends file-local functions and classes from lightweight structure. */
function appendFileContains(
	lines: string[],
	relPath: string,
	structure: ReturnType<typeof structureForFile>,
	{ limit }: { limit: number },
): void {
	if (structure === null) {
		return;
	}
	const contains = [
		...structure.functions.map(
			(item) => `${item.name} in ${relPath}:${item.startLine}`,
		),
		...structure.classes.map(
			(item) => `${item.name} class in ${relPath}:${item.startLine}`,
		),
	];
	if (contains.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Contains");
	for (const item of contains.slice(0, limit)) {
		lines.push(`- ${item}`);
	}
	appendLimitMarker(lines, contains.length, limit);
}

/** Formats a directory target relative to the display root. */
function directoryRelTarget(root: string, target: string): string {
	const resolved = path.resolve(root, target);
	const relative = path.relative(root, resolved).split(path.sep).join("/");
	return relative || ".";
}

/** Deduplicates rows while keeping first-seen order. */
function uniqueRows(rows: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const row of rows) {
		if (seen.has(row)) {
			continue;
		}
		seen.add(row);
		unique.push(row);
	}
	return unique;
}

/** Marks list sections that were shortened by the display limit. */
function appendLimitMarker(
	lines: string[],
	total: number,
	shown: number,
): void {
	if (total > shown) {
		lines.push("- ...");
	}
}

/** Parses the inspect output limit option. */
function inspectLimit(value: string | number | undefined): number {
	if (value === undefined) {
		return 8;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? 8 : parsed;
}

/** Formats values using Python-style repr for CLI compatibility. */
function pythonRepr(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
