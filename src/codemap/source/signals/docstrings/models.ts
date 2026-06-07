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

/** Stores docstring coverage and signature details for one function. */
export class FunctionReport {
	name: string;
	lineno: number;
	inputs: string;
	outputs: string;
	docstring: string | null;
	nestedFunctions: FunctionReport[];

	/** Stores function location, signature text, docstring, and nested functions. */
	constructor({
		name,
		lineno,
		inputs,
		outputs,
		docstring,
		nestedFunctions = [],
	}: {
		name: string;
		lineno: number;
		inputs: string;
		outputs: string;
		docstring: string | null;
		nestedFunctions?: FunctionReport[];
	}) {
		this.name = name;
		this.lineno = lineno;
		this.inputs = inputs;
		this.outputs = outputs;
		this.docstring = docstring;
		this.nestedFunctions = nestedFunctions;
	}
}

/** Stores docstring coverage and nested members for one class. */
export class ClassReport {
	name: string;
	lineno: number;
	docstring: string | null;
	methods: FunctionReport[];
	nestedClasses: ClassReport[];

	/** Stores class location, docstring, methods, and nested classes. */
	constructor({
		name,
		lineno,
		docstring = null,
		methods = [],
		nestedClasses = [],
	}: {
		name: string;
		lineno: number;
		docstring?: string | null;
		methods?: FunctionReport[];
		nestedClasses?: ClassReport[];
	}) {
		this.name = name;
		this.lineno = lineno;
		this.docstring = docstring;
		this.methods = methods;
		this.nestedClasses = nestedClasses;
	}
}

/** Stores docstring coverage for one parsed source file. */
export class FileReport {
	path: string;
	displayPath: string;
	fileDocstring: string | null;
	functions: FunctionReport[];
	classes: ClassReport[];
	parseError: string | null;

	/** Stores file identity, module docstring, parsed symbols, and parse errors. */
	constructor({
		path,
		displayPath,
		fileDocstring,
		functions = [],
		classes = [],
		parseError = null,
	}: {
		path: string;
		displayPath: string;
		fileDocstring: string | null;
		functions?: FunctionReport[];
		classes?: ClassReport[];
		parseError?: string | null;
	}) {
		this.path = path;
		this.displayPath = displayPath;
		this.fileDocstring = fileDocstring;
		this.functions = functions;
		this.classes = classes;
		this.parseError = parseError;
	}
}
