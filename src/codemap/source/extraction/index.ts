/** Re-exports scan, import-map, and structure extraction entrypoints. */
export type { ImportMapPayload } from "./import-map.js";
export { runImportMap } from "./import-map.js";
export type { ScanEntry, ScanPayload } from "./scan.js";
export {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
  runScan,
  scanEntry,
} from "./scan.js";
export { runStructure, structureForFile } from "./structure.js";
