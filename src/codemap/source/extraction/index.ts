/** Operation-local extraction: a mixed-file inventory, resolved project imports, and per-file structure for graphs. */
export type { ImportMapPayload } from "./import-map.js";
export { runImportMap } from "./import-map.js";
export type { ScanEntry } from "./scan.js";
export {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
  runScan,
  scanEntry,
} from "./scan.js";
export type { StructureEntry } from "./structure.js";
export { structureForFile } from "./structure.js";
