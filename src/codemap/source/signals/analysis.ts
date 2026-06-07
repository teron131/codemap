/** Builds refactor signal rows from file metrics and identifier usage. */
import { readFileSync } from "node:fs";

import type { FileMetrics, FunctionSpan } from "../scanner/index.js";

export const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
export const LOW_USAGE_MAX_REFERENCES = 5;

type Row = Record<string, unknown>;
type OccurrenceCounts = Map<string, number> | Record<string, unknown>;

/** Builds a compact row of file-level refactor signals. */
export function fileProfileRow(metrics: FileMetrics): Row {
	const total =
		metrics.defines +
		metrics.importsLocal +
		metrics.exports +
		metrics.reexportsLocal +
		metrics.extends +
		metrics.inherits +
		metrics.decorators;
	return {
		file: metrics.relPath,
		total,
		defines: metrics.defines,
		imports_local: metrics.importsLocal,
		exports: metrics.exports,
		reexports_local: metrics.reexportsLocal,
		extends: metrics.extends,
		inherits: metrics.inherits,
		jsx_components: metrics.jsxComponents,
		decorators: metrics.decorators,
		samples: metrics.samples.slice(0, 5),
	};
}

/** Classifies a file role from path and metrics. */
export function roleFor(
	filePath: string,
	row: Row,
	{ entrypoints }: { entrypoints: Set<string> },
): string {
	const defines = numberValue(row.defines);
	const importsLocal = numberValue(row.imports_local);
	const exports = numberValue(row.exports);
	const reexportsLocal = numberValue(row.reexports_local);
	const decorators = numberValue(row.decorators);
	if (entrypoints.has(filePath)) {
		return "likely entrypoint";
	}
	if (/(^|\/)(test_|.*\.test\.|.*_test\.)/.test(filePath)) {
		return "likely test/support";
	}
	if (filePath.endsWith(".py") && defines >= 8) {
		return "likely script hub";
	}
	if (reexportsLocal > 0 && defines === 0 && importsLocal === 0) {
		return "likely barrel";
	}
	if (/(types|schema|schemas)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
		return "likely contracts";
	}
	if (defines >= 6 || (defines >= 3 && importsLocal >= 2) || decorators >= 2) {
		return "likely hub";
	}
	if (exports >= 5 && importsLocal === 0 && defines <= 1) {
		return "likely contracts";
	}
	if (importsLocal >= 3) {
		return "likely integration";
	}
	return "likely module";
}

/** Scores a file profile row for likely-entry ranking. */
export function scoreFor(
	filePath: string,
	row: Row,
	{ entrypoints }: { entrypoints: Set<string> },
): number {
	const defines = numberValue(row.defines);
	const importsLocal = numberValue(row.imports_local);
	const exports = numberValue(row.exports);
	const extendsCount = numberValue(row.extends);
	const inherits = numberValue(row.inherits);
	const decorators = numberValue(row.decorators);
	let score =
		defines * 5 +
		importsLocal * 6 +
		extendsCount * 3 +
		inherits * 3 +
		decorators * 2 +
		exports;
	const role = roleFor(filePath, row, { entrypoints });
	if (entrypoints.has(filePath)) {
		score += 30;
	}
	if (role === "likely contracts") {
		score -= 8;
	}
	if (role === "likely barrel") {
		score -= 12;
	}
	if (role === "likely test/support") {
		score -= 10;
	}
	return score;
}

/** Ranks files that look like useful starting points. */
export function buildLikelyMainEntries(
	fileProfileRows: Row[],
	{ entrypoints }: { entrypoints: Set<string> },
): Row[] {
	const entries: Row[] = [];
	for (const row of fileProfileRows) {
		const filePath = String(row.file);
		const score = scoreFor(filePath, row, { entrypoints });
		if (score <= 0) {
			continue;
		}
		entries.push({
			score,
			file: filePath,
			role: roleFor(filePath, row, { entrypoints }),
			defines: numberValue(row.defines),
			imports_local: numberValue(row.imports_local),
			exports: numberValue(row.exports),
			reexports_local: numberValue(row.reexports_local),
			samples: row.samples,
			doc_preview: null,
		});
	}
	entries.sort(
		(left, right) =>
			-numberValue(left.score) - -numberValue(right.score) ||
			compareText(String(left.file), String(right.file)),
	);
	return entries;
}

/** Counts usage rows by reference-count bucket. */
export function usageDistribution(rows: Row[]): Record<string, number> {
	const buckets = new Map<string, number>();
	for (const row of rows) {
		const bucket = usageBucket(numberValue(row.count));
		buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
	}
	return {
		"0_1": buckets.get("0_1") ?? 0,
		"2": buckets.get("2") ?? 0,
		"3_5": buckets.get("3_5") ?? 0,
		"6_plus": buckets.get("6_plus") ?? 0,
	};
}

/** Maps a reference count to a usage distribution bucket. */
export function usageBucket(count: number): string {
	if (count <= 1) {
		return "0_1";
	}
	if (count === 2) {
		return "2";
	}
	if (count <= 5) {
		return "3_5";
	}
	return "6_plus";
}

/** Counts identifier occurrences across source files. */
export function countIdentifierOccurrences(
	files: string[],
): Map<string, number> {
	const counter = new Map<string, number>();
	for (const filePath of files) {
		let source: string;
		try {
			source = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		for (const match of source.matchAll(IDENTIFIER_RE)) {
			const name = match[0];
			counter.set(name, (counter.get(name) ?? 0) + 1);
		}
	}
	return counter;
}

/** Builds name usage rows from occurrence counts. */
export function usageRows(
	names: string[],
	occurrences: OccurrenceCounts,
): Row[] {
	const uniqueNames = [...new Set(names.filter(Boolean))].sort();
	return uniqueNames.map((name) => ({
		name,
		count: occurrenceCount(occurrences, name),
	}));
}

/** Checks whether a Python name uses double-underscore form. */
export function isDunderName(name: string): boolean {
	return name.length > 4 && name.startsWith("__") && name.endsWith("__");
}

/** Checks whether a symbol name is PascalCase. */
export function isPascalCaseName(name: string): boolean {
	return (
		Boolean(name) &&
		name[0] === name[0]?.toUpperCase() &&
		name !== name.toUpperCase()
	);
}

/** Checks whether a symbol name is all caps. */
export function isAllCapsName(name: string): boolean {
	const letters = [...name].filter((char) => /[A-Za-z]/.test(char));
	return (
		letters.length > 0 && letters.every((char) => char === char.toUpperCase())
	);
}

/** Builds low-reference rows for function definitions. */
export function functionUsageRows(
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
	occurrences: OccurrenceCounts,
	{ language }: { language: string },
): Row[] {
	const rows: Row[] = [];
	for (const metrics of scannedFiles) {
		if (!suffixes.has(metrics.suffix)) {
			continue;
		}
		const exportedNames = new Set(metrics.exportedNames);
		for (const span of metrics.functionSpans) {
			const name = span.name;
			const count = occurrenceCount(occurrences, name);
			rows.push({
				name,
				identifier: span.identifier,
				file: metrics.relPath,
				count,
				lines: span.span,
				exported: exportedNames.has(name),
				refactorCandidate: isLowUsageRefactorCandidate(name, count, {
					exported: exportedNames.has(name),
					language,
				}),
			});
		}
	}
	rows.sort(
		(left, right) =>
			numberValue(left.count) - numberValue(right.count) ||
			compareText(String(left.identifier), String(right.identifier)),
	);
	return rows;
}

/** Builds low-reference rows for variable definitions. */
export function variableUsageRows(
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
	occurrences: OccurrenceCounts,
	{ language }: { language: string },
): Row[] {
	const rows: Row[] = [];
	const seen = new Set<string>();
	for (const metrics of scannedFiles) {
		if (!suffixes.has(metrics.suffix)) {
			continue;
		}
		const exportedNames = new Set(metrics.exportedNames);
		for (const signal of metrics.variableSignals) {
			const key = `${signal.identifier}\0${signal.name}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const name = signal.name;
			const count = occurrenceCount(occurrences, name);
			rows.push({
				name,
				identifier: signal.identifier,
				file: metrics.relPath,
				count,
				line: signal.startLine,
				moduleLevel: signal.moduleLevel,
				exported: exportedNames.has(name),
				refactorCandidate: isLowUsageVariableRefactorCandidate(name, count, {
					exported: exportedNames.has(name),
					moduleLevel: signal.moduleLevel,
					language,
				}),
			});
		}
	}
	rows.sort(
		(left, right) =>
			numberValue(left.count) - numberValue(right.count) ||
			compareText(String(left.identifier), String(right.identifier)),
	);
	return rows;
}

/** Checks whether a function row is a low-use refactor candidate. */
export function isLowUsageRefactorCandidate(
	name: string,
	count: number,
	{ exported, language }: { exported: boolean; language: string },
): boolean {
	if (count > LOW_USAGE_MAX_REFERENCES) {
		return false;
	}
	if (exported) {
		return false;
	}
	if (language === "python") {
		return name.startsWith("_") && !isDunderName(name);
	}
	if (language === "typescript") {
		return !isPascalCaseName(name);
	}
	return true;
}

/** Checks whether a variable row is a low-use refactor candidate. */
export function isLowUsageVariableRefactorCandidate(
	name: string,
	count: number,
	{
		exported,
		moduleLevel,
		language,
	}: { exported: boolean; moduleLevel: boolean; language: string },
): boolean {
	if (count > LOW_USAGE_MAX_REFERENCES) {
		return false;
	}
	if (exported || !moduleLevel) {
		return false;
	}
	if (language === "python") {
		return name.startsWith("_") && !isDunderName(name);
	}
	if (language === "typescript") {
		return !isPascalCaseName(name) && !isAllCapsName(name);
	}
	return true;
}

/** Builds long-function rows from function spans. */
export function functionLengthSection(items: FunctionSpan[]): Row {
	const rows = items.map((item) => ({
		identifier: item.identifier,
		count: item.span,
	}));
	rows.sort(
		(left, right) =>
			-numberValue(left.count) - -numberValue(right.count) ||
			compareText(String(left.identifier), String(right.identifier)),
	);
	const counts = rows.map((row) => numberValue(row.count));
	if (counts.length === 0) {
		return { count: 0, median: 0, p90: 0, max: 0, items: [] };
	}
	const sortedCounts = counts.slice().sort((left, right) => left - right);
	const p90Index = Math.max(
		0,
		Math.min(
			sortedCounts.length - 1,
			Math.floor((sortedCounts.length * 9 + 9) / 10) - 1,
		),
	);
	return {
		count: rows.length,
		median: sortedCounts[Math.floor(sortedCounts.length / 2)] ?? 0,
		p90: sortedCounts[p90Index] ?? 0,
		max: sortedCounts.at(-1) ?? 0,
		items: rows,
	};
}

/** Selects file rows with the highest relationship count for a key. */
export function topHubs(
	fileProfileRows: Row[],
	{ key, limit = 3 }: { key: string; limit?: number },
): Row[] {
	const rows = fileProfileRows.filter((row) => numberValue(row[key]) > 0);
	rows.sort(
		(left, right) =>
			-numberValue(left[key]) - -numberValue(right[key]) ||
			compareText(String(left.file), String(right.file)),
	);
	return rows.slice(0, limit).map((row) => ({
		file: row.file,
		count: numberValue(row[key]),
	}));
}

/** Selects file rows with the highest inheritance activity. */
export function topInheritanceHubs(fileProfileRows: Row[], limit = 3): Row[] {
	const rows: Row[] = [];
	for (const row of fileProfileRows) {
		const count = numberValue(row.extends) + numberValue(row.inherits);
		if (count > 0) {
			rows.push({ file: row.file, count });
		}
	}
	rows.sort(
		(left, right) =>
			-numberValue(left.count) - -numberValue(right.count) ||
			compareText(String(left.file), String(right.file)),
	);
	return rows.slice(0, limit);
}

/** Reads a reference count for one identifier name. */
function occurrenceCount(occurrences: OccurrenceCounts, name: string): number {
	if (occurrences instanceof Map) {
		return occurrences.get(name) ?? 0;
	}
	return numberValue(occurrences[name]);
}

/** Reads a numeric field from untrusted row data. */
function numberValue(value: unknown): number {
	return Number(value ?? 0);
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
