/** Re-exports source, structural, and graph search APIs. */
export { type GraphMatchOptions, renderGraphMatchLines } from "./graph.js";
export {
  pathMatches,
  type SourceFallbackGroup,
  type SourceMatch,
  sourceFallbackMatches,
  sourceMatches,
} from "./source.js";
export { callMatches, resolveTargetPaths, searchRuleMatches } from "./structural.js";
