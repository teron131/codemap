/** Exposes structural matching and target resolution while keeping native parsing and traversal policy separate. */
export type { SyntaxMatch } from "./adapter.js";
export { loadRule, matchConfigFromRule, SyntaxSearch } from "./adapter.js";
export { resolveProjectFile } from "./targets.js";
