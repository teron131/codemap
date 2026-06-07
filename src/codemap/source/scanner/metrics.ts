/** Stores per-file scan metrics for imports, definitions, and code signals. */
export type FunctionSpan = {
	name: string;
	identifier: string;
	span: number;
	startLine: number;
};

export type VariableSignal = {
	name: string;
	identifier: string;
	startLine: number;
	moduleLevel: boolean;
};

/** Accumulates scanner metrics for one source file. */
export class FileMetrics {
	path: string;
	relPath: string;
	suffix: string;
	defines: number;
	importsLocal: number;
	exports: number;
	reexportsLocal: number;
	extends: number;
	inherits: number;
	decorators: number;
	jsxComponents: number;
	samples: string[];
	exportedNames: string[];
	entrypointHint: boolean;
	typescriptImportTargets: string[];
	typescriptLocalImportTargets: string[];
	typescriptReexportTargets: string[];
	typescriptLocalReexportTargets: string[];
	typescriptExtendsBases: string[];
	pyImportTargets: string[];
	pyLocalImportTargets: string[];
	pyBases: string[];
	functionNames: string[];
	variableNames: string[];
	variableSignals: VariableSignal[];
	functionSpans: FunctionSpan[];

	/** Starts one file metrics record with zeroed counters and empty samples. */
	constructor({
		path,
		relPath,
		suffix,
	}: {
		path: string;
		relPath: string;
		suffix: string;
	}) {
		this.path = path;
		this.relPath = relPath;
		this.suffix = suffix;
		this.defines = 0;
		this.importsLocal = 0;
		this.exports = 0;
		this.reexportsLocal = 0;
		this.extends = 0;
		this.inherits = 0;
		this.decorators = 0;
		this.jsxComponents = 0;
		this.samples = [];
		this.exportedNames = [];
		this.entrypointHint = false;
		this.typescriptImportTargets = [];
		this.typescriptLocalImportTargets = [];
		this.typescriptReexportTargets = [];
		this.typescriptLocalReexportTargets = [];
		this.typescriptExtendsBases = [];
		this.pyImportTargets = [];
		this.pyLocalImportTargets = [];
		this.pyBases = [];
		this.functionNames = [];
		this.variableNames = [];
		this.variableSignals = [];
		this.functionSpans = [];
	}
}

/** Adds a bounded identifier sample to a file metrics row. */
export function addSample(samples: string[], value: string): void {
	if (value && !samples.includes(value)) {
		samples.push(value);
	}
}

/** Builds the stable identifier for a scanned code signal. */
export function codeSignalIdentifier(relPath: string, name: string): string {
	return `${relPath}::${name}`;
}

/** Records a variable-like definition and sample on file metrics. */
export function addVariableSignal(
	metrics: FileMetrics,
	relPath: string,
	name: string,
	{
		startLine,
		moduleLevel,
	}: {
		startLine: number;
		moduleLevel: boolean;
	},
): void {
	if (!name) {
		return;
	}
	metrics.variableSignals.push({
		name,
		identifier: codeSignalIdentifier(relPath, name),
		startLine,
		moduleLevel,
	});
}
