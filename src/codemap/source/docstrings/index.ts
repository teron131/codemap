/** Re-exports docstring extraction used by summary, inspect, and signals. */
export { DOCSTRING_SUFFIXES, type FileReport } from "./models.js";
export {
  buildDocstringsData,
  buildDocstringSignals,
  collectReports,
  docstringForSymbol,
  docstringPreview,
  symbolDocstring,
} from "./report.js";
export { isIgnorableFileComment } from "./typescript.js";
