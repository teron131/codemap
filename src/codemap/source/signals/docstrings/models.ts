/** Defines docstring report objects for files, classes, and functions. */
export const PYTHON_SUFFIXES = new Set([".py"]);
export const TYPESCRIPT_SUFFIXES = new Set([".ts", ".tsx", ".js", ".jsx"]);
export const DOCSTRING_SUFFIXES = new Set([
	...PYTHON_SUFFIXES,
	...TYPESCRIPT_SUFFIXES,
]);

export const LIKELY_MAIN_FUNCTION_NAMES = [
	"main",
	"run",
	"start",
	"serve",
	"cli",
	"app",
	"create_app",
	"build_app",
	"invoke",
	"execute",
	"handler",
] as const;

export const LIKELY_MAIN_FUNCTION_PREFIXES = [
	"build_",
	"create_",
	"load_",
	"fetch_",
	"resolve_",
	"get_",
	"display_",
] as const;

export type FunctionReport = {
	name: string;
	lineno: number;
	inputs: string;
	outputs: string;
	docstring: string | null;
	nestedFunctions: FunctionReport[];
};

export type ClassReport = {
	name: string;
	lineno: number;
	docstring: string | null;
	methods: FunctionReport[];
	nestedClasses: ClassReport[];
};

export type FileReport = {
	path: string;
	displayPath: string;
	fileDocstring: string | null;
	functions: FunctionReport[];
	classes: ClassReport[];
	parseError: string | null;
};
