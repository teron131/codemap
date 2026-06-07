/** Builds usage-signal tables from scanned source metrics. */
import path from "node:path";

import {
	type FileMetrics,
	PY_SUFFIXES,
	TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import {
	countIdentifierOccurrences,
	functionUsageRows,
	usageDistribution,
	usageRows,
	variableUsageRows,
} from "./analysis.js";

type Row = Record<string, unknown>;

/** Collects metric names for files matching a language suffix set. */
export function metricNames(
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
	attrName: "functionNames" | "variableNames",
): string[] {
	const names: string[] = [];
	for (const metrics of scannedFiles) {
		if (suffixes.has(metrics.suffix)) {
			names.push(...metrics[attrName]);
		}
	}
	return names;
}

/** Builds usage distributions and low-use candidate tables. */
export function buildUsageSection(
	allFiles: string[],
	scannedFiles: FileMetrics[],
): Row {
	const pyFiles = allFiles.filter((filePath) =>
		PY_SUFFIXES.has(path.extname(filePath)),
	);
	const typescriptFiles = allFiles.filter((filePath) =>
		TYPESCRIPT_SUFFIXES.has(path.extname(filePath)),
	);
	const pyOccurrences = countIdentifierOccurrences(pyFiles);
	const typescriptOccurrences = countIdentifierOccurrences(typescriptFiles);
	const pyFunctionNames = metricNames(
		scannedFiles,
		PY_SUFFIXES,
		"functionNames",
	);
	const pyVariableNames = metricNames(
		scannedFiles,
		PY_SUFFIXES,
		"variableNames",
	);
	const typescriptFunctionNames = metricNames(
		scannedFiles,
		TYPESCRIPT_SUFFIXES,
		"functionNames",
	);
	const typescriptVariableNames = metricNames(
		scannedFiles,
		TYPESCRIPT_SUFFIXES,
		"variableNames",
	);
	const typescriptFunctionRows = usageRows(
		typescriptFunctionNames,
		typescriptOccurrences,
	);
	const typescriptVariableRows = usageRows(
		typescriptVariableNames,
		typescriptOccurrences,
	);
	const pyFunctionRows = usageRows(pyFunctionNames, pyOccurrences);
	const pyVariableRows = usageRows(pyVariableNames, pyOccurrences);
	return {
		distribution: {
			typescript_functions: usageDistribution(typescriptFunctionRows),
			typescript_variables: usageDistribution(typescriptVariableRows),
			python_functions: usageDistribution(pyFunctionRows),
			python_variables: usageDistribution(pyVariableRows),
		},
		tables: {
			typescript_functions: typescriptFunctionRows,
			typescript_function_candidates: functionUsageRows(
				scannedFiles,
				TYPESCRIPT_SUFFIXES,
				typescriptOccurrences,
				{ language: "typescript" },
			),
			typescript_variables: typescriptVariableRows,
			typescript_variable_candidates: variableUsageRows(
				scannedFiles,
				TYPESCRIPT_SUFFIXES,
				typescriptOccurrences,
				{ language: "typescript" },
			),
			python_functions: pyFunctionRows,
			python_function_candidates: functionUsageRows(
				scannedFiles,
				PY_SUFFIXES,
				pyOccurrences,
				{ language: "python" },
			),
			python_variables: pyVariableRows,
			python_variable_candidates: variableUsageRows(
				scannedFiles,
				PY_SUFFIXES,
				pyOccurrences,
				{ language: "python" },
			),
		},
	};
}
