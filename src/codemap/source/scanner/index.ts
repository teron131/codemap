/** Re-exports scanner constants, discovery, metrics, and language scanners. */
import path from "node:path";

import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "./constants.js";
import { relativePath } from "./discovery.js";
import { createFileMetrics, type FileMetrics } from "./metrics.js";
import { scanPythonFile } from "./python.js";
import { scanTypescriptFile } from "./typescript.js";

export {
	ENTRYPOINT_BASENAMES,
	IGNORED_DIR_NAMES,
	IGNORED_FILE_SUFFIXES,
	KEPT_HIDDEN_DIR_NAMES,
	PY_SUFFIXES,
	SCAN_BASENAMES,
	SCAN_SUFFIXES,
	TEXT_SUFFIXES,
	TYPESCRIPT_LANG_BY_SUFFIX,
	TYPESCRIPT_SUFFIXES,
} from "./constants.js";
export type { IgnoreRule } from "./discovery.js";
export {
	compileGitignoreRule,
	compileGlob,
	discoverFiles,
	discoverRipgrepFiles,
	gitignoreMatches,
	gitignoreRuleMatches,
	loadGitignoreRules,
	relativePath,
	shouldScanDir,
	shouldScanFile,
	walkFiles,
} from "./discovery.js";
export type { FileMetrics, FunctionSpan, VariableSignal } from "./metrics.js";
export {
	addSample,
	addVariableSignal,
	codeSignalIdentifier,
	createFileMetrics,
	sourceLineCount,
} from "./metrics.js";
export {
	collectPythonModuleVariables,
	collectPythonTopLevelDefinitions,
	isPythonEntrypoint,
	literalStrings,
	pythonFunctionIdentifier,
	scanPythonFile,
	targetNames,
} from "./python.js";
export {
	addExportedName,
	addTypescriptFunction,
	addTypescriptImport,
	addTypescriptReexport,
	descendant,
	directChild,
	isTypescriptModuleLevelVariable,
	scanTypescriptFile,
	spanFor,
	startLineFor,
	stringValue,
	walkSg,
} from "./typescript.js";

/** Scans one file with the matching language scanner. */
export function scanFile(
	filePath: string,
	{ displayRoot }: { displayRoot: string },
): FileMetrics {
	const relPath = relativePath(filePath, { displayRoot });
	const suffix = path.extname(filePath);
	if (PY_SUFFIXES.has(suffix)) {
		return scanPythonFile(filePath, { relPath });
	}
	if (TYPESCRIPT_SUFFIXES.has(suffix)) {
		return scanTypescriptFile(filePath, { relPath });
	}
	return createFileMetrics({
		path: filePath,
		relPath,
		suffix,
	});
}
