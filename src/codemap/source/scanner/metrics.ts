/** Retains per-file measurements and declaration spans shared by inspection, signals, and graph extraction. */
export type FunctionSpan = {
  name: string;
  identifier: string;
  span: number;
  startLine: number;
};

type ClassSpan = {
  name: string;
  span: number;
  startLine: number;
  methods: string[];
};

export type VariableSignal = {
  name: string;
  identifier: string;
  startLine: number;
  moduleLevel: boolean;
};

export type TypeScriptReexportBinding = {
  imported: string | null;
  exported: string;
};

export type TypeScriptReexport = {
  target: string;
  bindings: TypeScriptReexportBinding[] | null;
};

export type FileMetrics = {
  path: string;
  relPath: string;
  suffix: string;
  defines: number;
  importsLocal: number;
  exports: number;
  reexportsLocal: number;
  lines: number;
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
  typescriptReexports: TypeScriptReexport[];
  typescriptExtendsBases: string[];
  pyImportTargets: string[];
  pyLocalImportTargets: string[];
  pyBases: string[];
  functionNames: string[];
  variableNames: string[];
  variableSignals: VariableSignal[];
  functionSpans: FunctionSpan[];
  classSpans: ClassSpan[];
};

/** Starts one file metrics record with zeroed counters and empty samples. */
export function createFileMetrics({
  path,
  relPath,
  suffix,
}: {
  path: string;
  relPath: string;
  suffix: string;
}): FileMetrics {
  return {
    path,
    relPath,
    suffix,
    defines: 0,
    importsLocal: 0,
    exports: 0,
    reexportsLocal: 0,
    lines: 0,
    extends: 0,
    inherits: 0,
    decorators: 0,
    jsxComponents: 0,
    samples: [],
    exportedNames: [],
    entrypointHint: false,
    typescriptImportTargets: [],
    typescriptLocalImportTargets: [],
    typescriptReexportTargets: [],
    typescriptLocalReexportTargets: [],
    typescriptReexports: [],
    typescriptExtendsBases: [],
    pyImportTargets: [],
    pyLocalImportTargets: [],
    pyBases: [],
    functionNames: [],
    variableNames: [],
    variableSignals: [],
    functionSpans: [],
    classSpans: [],
  };
}

/** Counts newline-delimited lines in source text. */
export function sourceLineCount(source: string): number {
  if (!source) {
    return 0;
  }
  return source.split("\n").length - 1 + (source.endsWith("\n") ? 0 : 1);
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
