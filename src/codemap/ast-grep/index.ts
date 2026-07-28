/** Re-exports the shared ast-grep adapter surface. */
export type { SyntaxMatch } from "./adapter.js";
export {
  contextLines,
  loadRule,
  matchConfigFromRule,
  normalizeLanguage,
  resolveProjectFile,
  ruleMatches,
  SYNTAX_SUFFIXES_BY_LANGUAGE,
  syntaxMatches,
  targetFiles,
  targetLanguages,
} from "./adapter.js";
