/** Re-exports the source and graph search surface used by search commands. */
export type { GraphMatchOptions } from "./graph.js";
export { renderGraphMatchLines } from "./graph.js";
export type { SourceFallbackSearch, SourceMatch } from "./source.js";
export {
  conceptPathMatches,
  definitionMatches,
  isImplementationSourceMatch,
  isImplementationSourcePath,
  pathMatches,
  sourceFallbackMatches,
  sourceMatches,
} from "./source.js";
