/** Re-exports docstring signal models and language extractors. */
export type { ClassReport, FileReport, FunctionReport } from "./models.js";
export {
	DOCSTRING_SUFFIXES,
	LIKELY_MAIN_FUNCTION_NAMES,
	LIKELY_MAIN_FUNCTION_PREFIXES,
	PYTHON_SUFFIXES,
	TYPESCRIPT_SUFFIXES,
} from "./models.js";
export {
	buildClassReport,
	buildFunctionReport,
	buildPythonFileReport,
	formatArg,
	formatSignature,
	renderAnnotation,
	renderDefault,
} from "./python.js";
export type {
	DocstringSignals,
	DocstringsData,
	FilePreview,
} from "./report.js";
export {
	buildDocstringSignals,
	buildDocstringsData,
	buildFilePreviews,
	classToDict,
	collectReports,
	collectSignalFunctions,
	collectSupportedFiles,
	countClasses,
	countClassMethods,
	countFunctions,
	displayPath,
	docstringPreview,
	functionPriority,
	functionSignalCandidates,
	functionToDict,
	resolveFocusPathsInOrder,
	selectReports,
	supportedFocusPaths,
} from "./report.js";
export {
	appendArrowDeclarations,
	appendClassDeclarations,
	appendDocumentedValues,
	appendFunctionDeclarations,
	buildTypescriptFileReport,
	cleanBlockComment,
	cleanLineComment,
	declarationComment,
	fileComment,
	formatTypescriptParams,
	hasLeadingBlockComment,
	isIgnorableFileComment,
	lineIndexForOffset,
	lineStarts,
	TYPESCRIPT_ARROW_DECL_RE,
	TYPESCRIPT_CLASS_DECL_RE,
	TYPESCRIPT_FUNCTION_DECL_RE,
	TYPESCRIPT_VALUE_DECL_RE,
} from "./typescript.js";
