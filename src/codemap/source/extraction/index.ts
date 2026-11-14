/** Operation-local extraction: a mixed-file inventory and each file's imports resolved to inventoried files. */
export {
  BACKEND_DEFINITION_COLUMNS,
  backendDefinitionsQuery,
  backendFileMetrics,
} from "./backend-metrics.js";
export type { ImportMapPayload } from "./import-map.js";
export { runImportMap } from "./import-map.js";
export { ImportResolver } from "./import-resolver.js";
export type { InventoryEntry } from "./inventory.js";
export {
  backendOnlyCoverageLine,
  backendOnlyLanguages,
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
  buildInventory,
  languageForPath,
} from "./inventory.js";
