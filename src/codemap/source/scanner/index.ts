/** Re-exports scan discovery, per-file scanning, metrics, and language constants. */
export {
  ENTRYPOINT_BASENAMES,
  IGNORED_DIR_NAMES,
  PY_SUFFIXES,
  TYPESCRIPT_LANG_BY_SUFFIX,
  TYPESCRIPT_SUFFIXES,
} from "./constants.js";
export { discoverFiles, relativePath } from "./discovery.js";
export { isGeneratedPath, isSupportedSourcePath, isTestPath } from "./path-policy.js";
export type { FileMetrics, FunctionSpan } from "./metrics.js";
export { sourceLineCount } from "./metrics.js";
export { scanPythonFile } from "./python.js";
export { scanFile } from "./scan-file.js";
export { scanTypescriptFile } from "./typescript.js";
