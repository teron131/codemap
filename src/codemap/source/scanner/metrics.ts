/** Per-file measurement record that both language scanners fill and inspection, signals, and graph extraction share. */
/** `span` counts lines from `startLine`; `identifier` is `relPath::name`, with Python qualifying nested names by their scopes as in `a.py::Outer.inner`. */
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

export type TypeScriptImport = {
  target: string;
  kind: "import" | "require";
};

export type PythonImport =
  | { kind: "import"; names: string[] }
  | { kind: "from"; level: number; module: string; names: string[] };

export type SourceCall = {
  caller: string;
  callee: string;
  lineNumber: number;
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
  typescriptImports: TypeScriptImport[];
  typescriptLocalImportTargets: string[];
  typescriptReexportTargets: string[];
  typescriptLocalReexportTargets: string[];
  typescriptReexports: TypeScriptReexport[];
  typescriptExtendsBases: string[];
  pyImportTargets: string[];
  pythonImports: PythonImport[];
  pyLocalImportTargets: string[];
  pyBases: string[];
  functionNames: string[];
  variableNames: string[];
  variableSignals: VariableSignal[];
  functionSpans: FunctionSpan[];
  classSpans: ClassSpan[];
  callSites: SourceCall[];
};

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
    typescriptImports: [],
    typescriptLocalImportTargets: [],
    typescriptReexportTargets: [],
    typescriptLocalReexportTargets: [],
    typescriptReexports: [],
    typescriptExtendsBases: [],
    pyImportTargets: [],
    pythonImports: [],
    pyLocalImportTargets: [],
    pyBases: [],
    functionNames: [],
    variableNames: [],
    variableSignals: [],
    functionSpans: [],
    classSpans: [],
    callSites: [],
  };
}

/** A trailing newline does not start a line: `"a\nb\n"` and `"a\nb"` both count 2. */
export function sourceLineCount(source: string): number {
  if (!source) {
    return 0;
  }
  return source.split("\n").length - 1 + (source.endsWith("\n") ? 0 : 1);
}

export function addSample(samples: string[], value: string): void {
  if (value && !samples.includes(value)) {
    samples.push(value);
  }
}

export function codeSignalIdentifier(relPath: string, name: string): string {
  return `${relPath}::${name}`;
}

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
