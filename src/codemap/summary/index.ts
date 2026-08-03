/** Re-exports the summary view builders used by the summary command. */
export { buildRepositorySummary } from "./architecture/pipeline.js";
export { readmeSummaryFromText } from "./architecture/readme.js";
export {
  type ClusterSummary,
  type ExportCapability,
  type ExportSurface,
  type HotspotSummary,
  type LanguageSummary,
  type ReadmeSection,
  type RepositorySummary,
  type StructuralOutline,
  type StructuralReference,
  type StructuralSignal,
} from "./schema.js";
export { renderSummaryText } from "./presentation.js";
