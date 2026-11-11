/** Operation-local extraction: a mixed-file inventory and each file's imports resolved to inventoried files. */
export type { ImportMapPayload } from "./import-map.js";
export { runImportMap } from "./import-map.js";
export { ImportResolver } from "./import-resolver.js";
export type { InventoryEntry } from "./inventory.js";
export {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
  buildInventory,
} from "./inventory.js";
