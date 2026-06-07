/** Re-exports the shared ast-grep adapter and rendering surface. */
export type { SyntaxMatch, SyntaxRewriteResult } from "./adapter.js";
export {
	AST_GREP_IGNORED_DIR_NAMES,
	astGrepAvailable,
	astGrepRoot,
	contextLines,
	expandRewrite,
	LANGUAGE_ALIASES,
	loadRule,
	META_VAR_RE,
	matchConfigFromRule,
	normalizeLanguage,
	resolveProjectFile,
	ruleMatches,
	ruleResults,
	ruleRewrite,
	SYNTAX_SUFFIXES_BY_LANGUAGE,
	shouldScanAstGrepFile,
	syntaxDebugPayload,
	syntaxMatches,
	syntaxRewrite,
	targetFiles,
} from "./adapter.js";
export {
	matchJson,
	printRewriteResults,
	printSyntaxMatches,
	rewriteJson,
} from "./render.js";
