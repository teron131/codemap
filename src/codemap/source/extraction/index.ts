/** Re-exports scan, import-map, and structure extraction entrypoints. */
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
