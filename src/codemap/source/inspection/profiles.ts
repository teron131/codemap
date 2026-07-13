/** Renders file, directory, symbol, and variable inspection profiles. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { DETAILED_ANALYSIS_FILE_LIMIT } from "../../common.js";
import { type ScanEntry, structureForFile } from "../extraction/index.js";
import type { GraphPayload } from "../graph/index.js";
import { type FileMetrics, scanFile } from "../scanner/index.js";
import { denseFileCounters } from "../signals/render.js";
import { importBoundaryRows, metricsForFiles } from "./graph.js";

export type MetricRow = Record<string, unknown>;

export type FileInspectMetrics = {
	longFunctions: MetricRow[];
	lowUsageFunctions: MetricRow[];
	lowUsageVariables: MetricRow[];
	fileProfiles: MetricRow[];
};

export type LikelyEntryContext = {
	role?: unknown;
	reason?: unknown;
	description?: unknown;
};

/** Renders one file directly from scanner evidence when full graphing is too broad. */
export function renderLightweightFileInspection(
	root: string,
	target: string,
	files: ScanEntry[],
	{
		limit,
		likelyEntries,
	}: { limit: number; likelyEntries: Record<string, LikelyEntryContext> },
): string | null {
	const relTarget = relativeTargetPath(root, target);
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

/** Renders one directory directly from scan rows when full graphing is too broad. */
export function renderLightweightDirectoryInspection(
	root: string,
	target: string,
	files: ScanEntry[],
	{ limit }: { limit: number },
): string {
	const relTarget = relativeTargetPath(root, target);
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
				right.sizeLines - left.sizeLines || compareText(left.path, right.path),
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

/** Appends likely-entry navigation context for inspected files. */
export function appendLikelyEntryContext(
	lines: string[],
	context: LikelyEntryContext | undefined,
): void {
	if (context === undefined) {
		return;
	}
	const role = String(context.role ?? "").trim();
	const reason = String(context.reason ?? "").trim();
	const description = String(context.description ?? "").trim();
	if (!role && !reason && !description) {
		return;
	}
	lines.push("");
	lines.push("## Navigation Context");
	if (role) {
		lines.push(`- role: ${role}`);
	}
	if (reason) {
		lines.push(`- why: ${reason}`);
	}
	if (description) {
		lines.push(`- evidence: ${description}`);
	}
}

/** Flattens Python and TypeScript metric rows for one inspection profile. */
function languageMetricItems(section: MetricRow): MetricRow[] {
	return [...arrayRows(section.python), ...arrayRows(section.typescript)];
}

/** Finds scanner metrics for one inspection file path. */
export function fileMetricsForPath(
	metrics: Record<string, unknown>,
	relPath: string,
): FileInspectMetrics {
	const usageSignals = recordValue(metrics.usageSignals);
	const longFunctions = languageMetricItems(recordValue(metrics.longFunctions));
	const lowUsage = languageMetricItems(
		recordValue(usageSignals.lowUsageFunctions),
	);
	const lowUsageVariables = languageMetricItems(
		recordValue(usageSignals.lowUsageVariables),
	);
	const dense = arrayRows(metrics.fileProfiles).filter(
		(item) => item.file === relPath,
	);
	const identifierPrefix = `${relPath}::`;
	return {
		longFunctions: matchingIdentifierItems(longFunctions, identifierPrefix),
		lowUsageFunctions: matchingIdentifierItems(lowUsage, identifierPrefix),
		lowUsageVariables: matchingIdentifierItems(
			lowUsageVariables,
			identifierPrefix,
		),
		fileProfiles: dense,
	};
}

/** Finds file profile rows that mention an identifier. */
export function matchingIdentifierItems(
	items: MetricRow[],
	prefix: string,
): MetricRow[] {
	return items.filter((item) =>
		String(item.identifier ?? "").startsWith(prefix),
	);
}

/** Appends file metrics and related profile sections for inspection. */
export function appendFileProfile(
	lines: string[],
	fileMetrics: FileInspectMetrics,
	{ limit }: { limit: number },
): void {
	if (fileMetrics.longFunctions.length > 0) {
		lines.push("");
		lines.push("## Functions In File");
		for (const item of fileMetrics.longFunctions.slice(0, limit)) {
			lines.push(`- ${String(item.identifier)}: ${String(item.count)} lines`);
		}
		appendLimitMarker(lines, fileMetrics.longFunctions.length, limit);
	}
	appendMentionRows(
		lines,
		"## Low-Use Internal Functions In File",
		fileMetrics.lowUsageFunctions,
		{ limit },
	);
	appendMentionRows(
		lines,
		"## Low-Use Internal Variables In File",
		fileMetrics.lowUsageVariables,
		{ limit },
	);
	appendFileProfileRow(lines, fileMetrics.fileProfiles);
}

/** Appends a limited lexical-mention table to an inspection profile. */
export function appendMentionRows(
	lines: string[],
	title: string,
	rows: MetricRow[],
	{ limit }: { limit: number },
): void {
	if (rows.length === 0) {
		return;
	}
	lines.push("");
	lines.push(title);
	for (const item of rows.slice(0, limit)) {
		const identifier = item.identifier || item.name;
		lines.push(`- ${String(identifier)}: ${String(item.count ?? 0)} mentions`);
	}
	appendLimitMarker(lines, rows.length, limit);
}

/** Appends one file-profile row to inspection output. */
export function appendFileProfileRow(lines: string[], rows: MetricRow[]): void {
	if (rows.length === 0) {
		return;
	}
	const profile = rows[0] ?? {};
	const samples = arrayValue(profile.samples)
		.slice(0, 6)
		.map((sample) => String(sample))
		.join(", ");
	lines.push("");
	lines.push("## File Profile");
	lines.push(
		`- ${denseFileCounters(profile, { includeProfileDetails: true })}`,
	);
	if (samples) {
		lines.push(`- samples: ${samples}`);
	}
}

/** Appends file, line, and child summaries for a symbol node. */
export function appendSymbolProfile(lines: string[], node: MetricRow): void {
	const nodeType = titleCase(String(node.type ?? "symbol"));
	if (!["Function", "Class"].includes(nodeType)) {
		return;
	}
	const lineRange = Array.isArray(node.lineRange) ? node.lineRange : [];
	const parts = [`file: ${String(node.filePath)}`];
	if (lineRange.length > 0) {
		parts.push(`lines: ${String(lineRange[0])}-${String(lineRange.at(-1))}`);
	}
	lines.push("");
	lines.push(`## ${nodeType} Profile`);
	lines.push(`- ${parts.join(", ")}`);
}

/** Renders definitions and owning files for a requested variable symbol. */
export function renderVariableProfile(
	target: string,
	metrics: Record<string, unknown>,
	{ limit }: { limit: number },
): string | null {
	const rows = definitionRows(metrics, "variableDefinitions", target);
	if (rows.length === 0) {
		return null;
	}
	const lines = [`# ${target}`, "", "Variable profile.", "", "## Definitions"];
	for (const item of rows.slice(0, limit)) {
		const scope = item.moduleLevel ? "module" : "local";
		lines.push(
			`- ${String(item.identifier)}: line ${String(item.line)}, ${scope}`,
		);
	}
	appendLimitMarker(lines, rows.length, limit);
	appendDefinitionFileProfiles(lines, metrics, rows);
	return lines.join("\n").trim();
}

/** Selects metric definitions matching a short or qualified target name. */
function definitionRows(
	metrics: Record<string, unknown>,
	key: "variableDefinitions",
	target: string,
): MetricRow[] {
	return arrayRows(metrics[key]).filter(
		(item) =>
			item.name === target ||
			String(item.identifier ?? "").endsWith(`::${target}`),
	);
}

/** Appends file facts shared by definition-only fallback profiles. */
function appendDefinitionFileProfiles(
	lines: string[],
	metrics: Record<string, unknown>,
	rows: MetricRow[],
): void {
	const rowFiles = new Set(rows.map((item) => item.file));
	const fileRows = arrayRows(metrics.fileProfiles).filter((row) =>
		rowFiles.has(row.file),
	);
	appendFileProfileRow(lines, fileRows);
}

/** Renders file, import, export, and contained-node summaries for a directory. */
export function renderDirectoryProfile(
	root: string,
	graph: GraphPayload,
	metrics: Record<string, unknown>,
	target: string,
	{ limit }: { limit: number },
): string | null {
	const targetPath = path.join(root, target);
	if (!isDirectory(targetPath)) {
		return null;
	}
	const rows = directoryFileRows(metrics, target);
	const title =
		target === "" || target === "." ? "." : target.replace(/\/+$/, "");
	const totalDefines = rows.reduce(
		(sum, item) => sum + numberValue(item.defines),
		0,
	);
	const totalImports = rows.reduce(
		(sum, item) => sum + numberValue(item.imports_local),
		0,
	);
	const lines = [
		`# ${title}/`,
		"",
		`Directory profile: ${rows.length} scanned files; defines ${totalDefines}; local imports ${totalImports}.`,
	];
	const denseRows = rows
		.slice()
		.sort(
			(left, right) =>
				numberValue(right.total) - numberValue(left.total) ||
				compareText(String(left.file ?? ""), String(right.file ?? "")),
		);
	if (denseRows.length > 0) {
		lines.push("");
		lines.push("## Dense Files");
		for (const item of denseRows.slice(0, limit)) {
			lines.push(
				`- ${String(item.file)}: ${denseFileCounters(item, { includeProfileDetails: true })}`,
			);
		}
		appendLimitMarker(lines, denseRows.length, limit);
	}
	const [incoming, outgoing] = importBoundaryRows(
		graph,
		new Set(rows.map((item) => String(item.file))),
		{ limit },
	);
	appendBoundaryRows(lines, "Incoming Imports", incoming);
	appendBoundaryRows(lines, "Outgoing Imports", outgoing);
	if (rows.length > 0) {
		lines.push("");
		lines.push("## Files");
		for (const item of rows
			.slice()
			.sort((left, right) =>
				compareText(String(left.file ?? ""), String(right.file ?? "")),
			)
			.slice(0, limit)) {
			lines.push(`- ${String(item.file)}`);
		}
		appendLimitMarker(lines, rows.length, limit);
	}
	return lines.join("\n").trim();
}

/** Selects file-profile rows that belong to an inspected directory. */
export function directoryFileRows(
	metrics: Record<string, unknown>,
	target: string,
): MetricRow[] {
	const rows = arrayRows(metrics.fileProfiles);
	if (target === "" || target === ".") {
		return rows;
	}
	const prefix = `${target.replace(/\/+$/, "")}/`;
	return rows.filter((item) => String(item.file ?? "").startsWith(prefix));
}

/** Appends import or export boundary rows to a profile section. */
export function appendBoundaryRows(
	lines: string[],
	title: string,
	rows: string[],
): void {
	if (rows.length === 0) {
		return;
	}
	lines.push("");
	lines.push(`## ${title}`);
	for (const row of rows) {
		lines.push(`- ${row}`);
	}
}

/** Appends raw imports seen in one lightweight file inspection. */
function appendFileImportSpecs(
	lines: string[],
	metrics: FileMetrics,
	{ limit }: { limit: number },
): void {
	const imports = uniqueTextRows([
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

/** Appends file-local functions and classes to one lightweight profile. */
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

/** Formats an inspected path relative to the display root. */
function relativeTargetPath(root: string, target: string): string {
	const resolved = path.resolve(root, target);
	const relative = path.relative(root, resolved).split(path.sep).join("/");
	return relative || ".";
}

/** Deduplicates text rows while keeping first-seen order. */
function uniqueTextRows(rows: string[]): string[] {
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

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): MetricRow {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as MetricRow)
		: {};
}

/** Reads an array of record rows from JSON-like payload data. */
function arrayRows(value: unknown): MetricRow[] {
	return Array.isArray(value) ? (value as MetricRow[]) : [];
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads a numeric field from untrusted row data. */
function numberValue(value: unknown): number {
	return Number(value ?? 0);
}

/** Formats labels for output headings. */
function titleCase(value: string): string {
	return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

/** Checks the directory condition used by source inspection profiles. */
function isDirectory(filePath: string): boolean {
	try {
		return existsSync(filePath) && statSync(filePath).isDirectory();
	} catch {
		return false;
	}
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
