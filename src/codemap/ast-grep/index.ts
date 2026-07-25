/** Re-exports the shared ast-grep adapter surface. */
export type { SyntaxMatch } from "./adapter.js";
export {
  astGrepRoot,
  contextLines,
  LANGUAGE_ALIASES,
  loadRule,
  matchConfigFromRule,
  normalizeLanguage,
  resolveProjectFile,
  ruleMatches,
  SYNTAX_SUFFIXES_BY_LANGUAGE,
  shouldScanAstGrepFile,
  syntaxMatches,
  targetFiles,
  targetLanguages,
} from "./adapter.js";
