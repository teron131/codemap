/** Renders file, directory, symbol, and variable inspection profiles. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { GraphPayload } from "../graph/index.js";
import { languageMetricItems } from "../signals/index.js";
import { importBoundaryRows } from "./graph.js";

export type MetricRow = Record<string, unknown>;

export type FileInspectMetrics = {
	longFunctions: MetricRow[];
	lowUsageFunctions: MetricRow[];
	lowUsageVariables: MetricRow[];
	fileProfiles: MetricRow[];
};

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
		lines.push("## Long Functions In File");
		for (const item of fileMetrics.longFunctions.slice(0, limit)) {
			lines.push(`- ${String(item.identifier)}: ${String(item.count)} lines`);
		}
	}
	appendReferenceRows(
		lines,
		"## Low-Use Internal Functions In File",
		fileMetrics.lowUsageFunctions,
		{ limit },
	);
	appendReferenceRows(
		lines,
		"## Low-Use Internal Variables In File",
		fileMetrics.lowUsageVariables,
		{ limit },
	);
	appendFileProfileRow(lines, fileMetrics.fileProfiles);
}

/** Appends a limited reference table to an inspection profile. */
export function appendReferenceRows(
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
		lines.push(
			`- ${String(identifier)}: ${String(item.count ?? 0)} references`,
		);
	}
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
		`- signals=${String(profile.total)}, defines=${String(profile.defines)}, imports=${String(profile.imports_local)}, exports=${String(profile.exports)}`,
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
	const rows = arrayRows(metrics.variableDefinitions).filter(
		(item) =>
			item.name === target ||
			String(item.identifier ?? "").endsWith(`::${target}`),
	);
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
	const rowFiles = new Set(rows.map((item) => item.file));
	const fileRows = arrayRows(metrics.fileProfiles).filter((row) =>
		rowFiles.has(row.file),
	);
	appendFileProfileRow(lines, fileRows);
	return lines.join("\n").trim();
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
				`- ${String(item.file)}: signals=${String(item.total)}, defines=${String(item.defines)}, imports=${String(item.imports_local)}`,
			);
		}
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

/** Formats labels for report headings. */
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
