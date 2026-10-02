/** Exposes structural matching and target resolution while keeping native parsing and traversal policy separate. */
export type { SyntaxMatch } from "./adapter.js";
export { contextLines, loadRule, matchConfigFromRule, SyntaxSearch } from "./adapter.js";
export {
  normalizeLanguage,
  resolveProjectFile,
  SYNTAX_SUFFIXES_BY_LANGUAGE,
  targetFiles,
} from "./targets.js";
