/** Defines CLI behavior for refactor signal output. */
import { existsSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import {
	codebaseMemoryQueryRows,
	codebaseMemoryQueryWithProject,
} from "../codebase-memory/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { runScan } from "../source/extraction/index.js";
import {
	buildSignalExport,
	buildSignalPayload,
	isGeneratedSignalPath,
	isTestPath,
	renderSignalText,
	runSignalsExport,
	SIGNAL_OUTPUT_ROW_LIMIT,
	SIGNAL_SECTION_CHOICES,
	SIGNAL_TOP_ROW_LIMIT,
	selectPayloadSection,
} from "../source/signals/index.js";
import { buildLightweightSignalPayload } from "../source/signals/lightweight.js";
import { addProjectRootArgument } from "./options.js";

type SignalOptions = {
	projectRoot?: string;
	includeTests?: boolean;
	json?: boolean;
};

type SignalPayloadOptions = {
	includeTests?: boolean;
};

type BackendFunctionPressure = {
	freshness: "fresh" | "partial" | "degraded";
	rows: Record<string, unknown>[];
};

type RootOptions = {
	projectRoot?: string;
};

const FUNCTION_PRESSURE_POLICY = {
	cognitiveThreshold: 15,
	cyclomaticThreshold: 10,
	linearScanThreshold: 1,
	linearScanWeight: 50,
	cognitiveWeight: 10,
	cyclomaticWeight: 2,
} as const;

const BACKEND_FUNCTION_PRESSURE_QUERY = [
	"MATCH (f)",
	"WHERE (f:Function OR f:Method)",
	`AND (f.cognitive >= ${FUNCTION_PRESSURE_POLICY.cognitiveThreshold} OR f.complexity >= ${FUNCTION_PRESSURE_POLICY.cyclomaticThreshold} OR f.linear_scan_in_loop >= ${FUNCTION_PRESSURE_POLICY.linearScanThreshold})`,
	"RETURN f.name AS name, f.file_path AS file_path, f.start_line AS start_line, f.lines AS lines, f.complexity AS complexity, f.cognitive AS cognitive, f.linear_scan_in_loop AS linear_scan_in_loop, f.is_test AS is_test",
	`ORDER BY (CASE WHEN coalesce(f.linear_scan_in_loop, 0) >= ${FUNCTION_PRESSURE_POLICY.linearScanThreshold} THEN ${FUNCTION_PRESSURE_POLICY.linearScanWeight} ELSE 0 END) + coalesce(f.cognitive, 0) * ${FUNCTION_PRESSURE_POLICY.cognitiveWeight} + coalesce(f.complexity, 0) * ${FUNCTION_PRESSURE_POLICY.cyclomaticWeight} DESC, coalesce(f.lines, 0) DESC, f.file_path, f.name`,
].join(" ");

const BACKEND_FUNCTION_PRESSURE_COLUMNS = [
	"name",
	"file_path",
	"start_line",
	"lines",
	"complexity",
	"cognitive",
	"linear_scan_in_loop",
	"is_test",
];
const BACKEND_FUNCTION_PRESSURE_QUERY_LIMIT = SIGNAL_TOP_ROW_LIMIT * 5;

/** Registers refactor signal commands and output modes. */
export function addSignalsParser(program: Command): void {
	const signals = program
		.command("signals")
		.description(
			"Print compact refactor evidence from the backend and current tree.",
		)
		.argument("[section]", "Signal section to print.", "top")
		.option(
			"--include-tests",
			"Include likely test files in file-specific signal rows.",
		)
		.option(
			"--json",
			"Print signal tables as JSON for jq, scripts, and agent pipelines.",
		)
		.action((section: string, options: SignalOptions) => {
			const exitCode = commandSignals(
				section,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(signals);
}

/** Runs refactor signal analysis and prints text or JSON output. */
export function commandSignals(
	section: string,
	options: SignalOptions,
	rootOptions: RootOptions = {},
): number {
	if (!SIGNAL_SECTION_CHOICES.includes(section as never)) {
		console.error(
			`error: argument section: invalid choice: '${section}' (choose from ${SIGNAL_SECTION_CHOICES.map((choice) => `'${choice}'`).join(", ")})`,
		);
		return 2;
	}
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	let selected: Record<string, unknown>;
	try {
		selected = buildCurrentTreeSignalPayload(root, section, {
			includeTests: Boolean(options.includeTests),
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	selected = addBackendFunctionPressure(selected, section, root, {
		includeTests: Boolean(options.includeTests),
	});
	if (options.json) {
		console.log(JSON.stringify(selected));
	} else {
		console.log(renderSignalText(selected, section).trim());
	}
	return 0;
}

/** Adds bounded backend function evidence to compact top output. */
function addBackendFunctionPressure(
	payload: Record<string, unknown>,
	section: string,
	root: string,
	{ includeTests }: { includeTests: boolean },
): Record<string, unknown> {
	if (section !== "top" && section !== "all") {
		return payload;
	}
	const backend = backendFunctionPressure(root, { includeTests });
	if (section === "top") {
		const functionPressure = mergedFunctionPressure(
			backend,
			arrayValue(payload.functionPressure),
		);
		return {
			...payload,
			freshness: backend.freshness,
			functionPressure,
		};
	}
	const top = recordValue(payload.top);
	return {
		...payload,
		freshness: backend.freshness,
		top: {
			...top,
			functionPressure: mergedFunctionPressure(
				backend,
				arrayValue(top.functionPressure),
			),
		},
	};
}

/** Keeps local pressure on degraded or partial indexes without duplicating rows. */
function mergedFunctionPressure(
	backend: BackendFunctionPressure,
	localRows: Record<string, unknown>[],
): Record<string, unknown>[] {
	if (backend.freshness === "fresh") {
		return backend.rows;
	}
	const rows = backend.rows.slice(0, SIGNAL_TOP_ROW_LIMIT);
	if (rows.length >= SIGNAL_TOP_ROW_LIMIT) {
		return rows;
	}
	const seen = new Set(rows.map(functionPressureKey));
	for (const row of localRows) {
		const key = functionPressureKey(row);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		rows.push(row);
		if (rows.length >= SIGNAL_TOP_ROW_LIMIT) {
			break;
		}
	}
	return rows;
}

/** Builds a stable source identity for mixed backend and local pressure rows. */
function functionPressureKey(row: Record<string, unknown>): string {
	return `${String(row.path ?? "")}\0${String(row.name ?? "")}`;
}

/** Queries and normalizes the strongest backend function-pressure fields. */
function backendFunctionPressure(
	root: string,
	{ includeTests }: { includeTests: boolean },
): BackendFunctionPressure {
	const result = codebaseMemoryQueryWithProject(
		root,
		BACKEND_FUNCTION_PRESSURE_QUERY,
		BACKEND_FUNCTION_PRESSURE_QUERY_LIMIT,
	);
	if (result === null) {
		return { freshness: "degraded", rows: [] };
	}
	const queryRows = codebaseMemoryQueryRows(
		result.value,
		BACKEND_FUNCTION_PRESSURE_COLUMNS,
	);
	if (queryRows === null) {
		return { freshness: "degraded", rows: [] };
	}
	const rows = queryRows
		.map((row) => functionPressureRow(root, row, { includeTests }))
		.filter((row) => row !== null)
		.sort(compareFunctionPressure)
		.slice(0, SIGNAL_TOP_ROW_LIMIT);
	return {
		freshness: result.freshness === "partial" ? "partial" : "fresh",
		rows,
	};
}

/** Compacts one backend function row after verifying its current source path. */
function functionPressureRow(
	root: string,
	row: Record<string, unknown>,
	{ includeTests }: { includeTests: boolean },
): Record<string, unknown> | null {
	const name = stringField(row.name);
	const filePath = stringField(row.file_path);
	if (
		name === null ||
		filePath === null ||
		!existsSync(path.join(root, filePath))
	) {
		return null;
	}
	if (
		isGeneratedSignalPath(filePath) ||
		(!includeTests && (booleanField(row.is_test) || isTestPath(filePath)))
	) {
		return null;
	}
	const cognitive = numericField(row.cognitive);
	const cyclomatic = numericField(row.complexity);
	const linearScanInLoop = numericField(row.linear_scan_in_loop);
	if (
		cognitive < FUNCTION_PRESSURE_POLICY.cognitiveThreshold &&
		cyclomatic < FUNCTION_PRESSURE_POLICY.cyclomaticThreshold &&
		linearScanInLoop < FUNCTION_PRESSURE_POLICY.linearScanThreshold
	) {
		return null;
	}
	return {
		name,
		path: filePath,
		line: numericField(row.start_line),
		lines: numericField(row.lines),
		cognitive,
		cyclomatic,
		...(linearScanInLoop > 0 ? { linearScanInLoop } : {}),
	};
}

/** Ranks linear scans alongside cognitive and cyclomatic pressure. */
function compareFunctionPressure(
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): number {
	return (
		functionPressureScore(right) - functionPressureScore(left) ||
		numericField(right.lines) - numericField(left.lines) ||
		String(left.path).localeCompare(String(right.path)) ||
		String(left.name).localeCompare(String(right.name))
	);
}

/** Ranks coarse scan presence below measured cognitive and cyclomatic pressure. */
function functionPressureScore(row: Record<string, unknown>): number {
	return (
		(numericField(row.linearScanInLoop) >=
		FUNCTION_PRESSURE_POLICY.linearScanThreshold
			? FUNCTION_PRESSURE_POLICY.linearScanWeight
			: 0) +
		numericField(row.cognitive) * FUNCTION_PRESSURE_POLICY.cognitiveWeight +
		numericField(row.cyclomatic) * FUNCTION_PRESSURE_POLICY.cyclomaticWeight
	);
}

/** Reads number-like graph fields emitted as JSON numbers or strings. */
function numericField(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Reads boolean graph fields emitted as JSON booleans or strings. */
function booleanField(value: unknown): boolean {
	return value === true || value === "true" || value === 1 || value === "1";
}

/** Reads nonempty string fields from backend rows. */
function stringField(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Builds the selected current-tree signal payload for CLI output. */
function buildCurrentTreeSignalPayload(
	root: string,
	section: string,
	options: SignalPayloadOptions = {},
): Record<string, unknown> {
	if (isDocstringSection(section)) {
		const payload = docstringSignalPayload(root, section);
		return selectPayloadSection(payload, section);
	}
	const scan = runScan(root);
	if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
		const payload = buildLightweightSignalPayload(scan.files, {
			includeTests: Boolean(options.includeTests),
			root,
		});
		return selectPayloadSection(payload, section);
	}
	const signalExport = runSignalsExport(root);
	if (signalExport.status !== "ok") {
		throw new Error(
			`Signals unavailable: ${String(signalExport.message ?? "unknown error")}`,
		);
	}
	const payload = buildSignalPayload(signalExport, {
		limit: SIGNAL_OUTPUT_ROW_LIMIT,
		includeTests: Boolean(options.includeTests),
	});
	if (section === "all") {
		Object.assign(payload, docstringSignalPayload(root, "docstring-signals"));
	}
	return selectPayloadSection(payload, section);
}

/** Checks whether a requested section needs docstring extraction. */
function isDocstringSection(
	section: string,
): section is "docstring-signals" | "docstrings" {
	return section === "docstring-signals" || section === "docstrings";
}

/** Builds docstring sections without forcing full signal export work. */
function docstringSignalPayload(
	root: string,
	section: "docstring-signals" | "docstrings",
): Record<string, unknown> {
	const signalExport = buildSignalExport(root, {
		sectionMode: section,
	});
	const sections = recordValue(signalExport.sections);
	return {
		docstring_signals: sections.docstring_signals ?? {},
		docstrings: sections.docstrings ?? {},
	};
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads record rows from an untrusted JSON-like value. */
function arrayValue(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
