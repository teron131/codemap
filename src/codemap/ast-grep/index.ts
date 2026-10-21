/** Structural search on ast-grep's bundled parsers, with no CLI dependency. Target paths resolve only inside the project root. */
export type { SyntaxMatch } from "./adapter.js";
export { loadRule, matchConfigFromRule, SyntaxSearch } from "./adapter.js";
export { resolveProjectFile } from "./targets.js";
