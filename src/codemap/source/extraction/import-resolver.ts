/** One operation's import resolution for both language families, limited to targets inside the inspected file inventory. */
import { type FileMetrics, PYTHON_SUFFIXES, type TypeScriptImport } from "../scanner/index.js";
import {
  pythonImportTargets,
  type PythonModuleIndex,
  pythonModuleIndex,
} from "./python-imports.js";
import { typescriptImportTargets, TypeScriptResolver } from "./typescript-imports.js";

/** Holds the Python module index and TypeScript resolution caches, so build one per operation rather than per file. */
export class ImportResolver {
  private readonly pythonModules: PythonModuleIndex;
  private readonly typescript: TypeScriptResolver;

  constructor(
    root: string,
    private readonly filePaths: Set<string>,
  ) {
    this.pythonModules = pythonModuleIndex(filePaths);
    this.typescript = new TypeScriptResolver(root, filePaths);
  }

  /** Sorted project-relative paths of the inventoried files that `metrics`' file imports or re-exports. */
  targets(metrics: FileMetrics): string[] {
    return PYTHON_SUFFIXES.has(metrics.suffix)
      ? pythonImportTargets(metrics, this.filePaths, this.pythonModules)
      : typescriptImportTargets(metrics, this.typescript);
  }

  /** Empty when the specifier resolves outside the inventory or not at all. */
  resolveTypescript(
    filePath: string,
    specifier: string,
    kind: TypeScriptImport["kind"] = "import",
  ): string[] {
    return this.typescript.resolve(filePath, specifier, kind);
  }
}
