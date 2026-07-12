/** Collects scanner metrics for files selected by inspection targets. */
import path from "node:path";

import type { ScanEntry } from "../extraction/index.js";
import {
	type FileMetrics,
	PY_SUFFIXES,
	scanFile,
	TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import { fileProfileRow, functionLengthSection } from "../signals/index.js";

type Row = Record<string, unknown>;

/** Creates the empty usage-metric buckets used by inspection output. */
export function emptyUsageMetrics(): Record<string, Record<string, Row[]>> {
	return {
		lowUsageFunctions: { python: [], typescript: [] },
		lowUsageVariables: { python: [], typescript: [] },
	};
}

/** Builds scanner metrics for selected inspection files. */
export function metricsForFiles(
	root: string,
	files: ScanEntry[],
	fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Record<string, unknown> {
	const scanned: FileMetrics[] = [];
	for (const item of files) {
		const relPath = item.path;
		let metrics = fileMetricsByPath[relPath];
		if (metrics === undefined) {
			metrics = scanFile(path.join(root, relPath), { displayRoot: root });
		}
		const sizeLines = item.sizeLines;
		if (sizeLines > 0 && metrics.lines === 0) {
			metrics.lines = sizeLines;
		}
		scanned.push(metrics);
	}
	const pythonSpans = scanned
		.filter((metrics) => PY_SUFFIXES.has(metrics.suffix))
		.flatMap((metrics) => metrics.functionSpans);
	const typescriptSpans = scanned
		.filter((metrics) => TYPESCRIPT_SUFFIXES.has(metrics.suffix))
		.flatMap((metrics) => metrics.functionSpans);
	return {
		longFunctions: {
			python: functionItems(pythonSpans),
			typescript: functionItems(typescriptSpans),
		},
		usageSignals: emptyUsageMetrics(),
		fileProfiles: scanned.map((metrics) => fileProfileRow(metrics)),
		functionDefinitions: functionDefinitionRows(scanned),
		variableDefinitions: variableDefinitionRows(scanned),
	};
}

/** Flattens scanned function spans into inspection table rows. */
export function functionDefinitionRows(scanned: FileMetrics[]): Row[] {
	return scanned.flatMap((metrics) =>
		metrics.functionSpans.map((span) => ({
			name: span.name,
			identifier: span.identifier,
			file: metrics.relPath,
			line: span.startLine,
			lines: span.span,
		})),
	);
}

/** Flattens scanned variable definitions into inspection table rows. */
export function variableDefinitionRows(scanned: FileMetrics[]): Row[] {
	return scanned.flatMap((metrics) =>
		metrics.variableSignals.map((variable) => ({
			name: variable.name,
			identifier: variable.identifier,
			file: metrics.relPath,
			line: variable.startLine,
			moduleLevel: variable.moduleLevel,
		})),
	);
}

/** Extracts printable function-length rows from scanned function spans. */
function functionItems(functionSpans: FileMetrics["functionSpans"]): Row[] {
	const section = functionLengthSection(functionSpans);
	return Array.isArray(section.items) ? section.items : [];
}
