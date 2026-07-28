/** Re-exports source, structural, and graph search APIs. */
export { type GraphMatchOptions, renderGraphMatchLines } from "./graph.js";
export {
  conceptPathMatches,
  definitionMatches,
  isImplementationSourcePath,
  isImplementationSourceMatch,
  pathMatches,
  type SourceFallbackSearch,
  type SourceMatch,
  sourceFallbackMatches,
  sourceMatches,
} from "./source.js";
export { callMatches, resolveTargetPaths, searchRuleMatches } from "./structural.js";
