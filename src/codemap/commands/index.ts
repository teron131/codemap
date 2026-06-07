/** Re-exports command parsers, dispatchers, and handlers. */
export {
	addArtifactsParsers,
	commandArtifactsCreate,
	commandArtifactsStatus,
	commandArtifactsUpdate,
	commandArtifactsView,
} from "./artifacts.js";
export { buildParser, dispatch, main, run } from "./cli.js";
export { addInspectParser, commandInspect } from "./inspect.js";
export { addProjectRootArgument, PROJECT_ROOT_HELP } from "./options.js";
export {
	addSearchParser,
	commandSearch,
	printSemanticMatches,
	printSourceMatches,
} from "./search.js";
export {
	addSearchCallsParser,
	addSearchMatchParser,
	addSearchRuleParser,
	commandSearchCalls,
	commandSearchMatch,
	commandSearchRule,
	DEFAULT_STRICTNESS,
} from "./search-structural.js";
export {
	addSemanticParsers,
	commandSemanticInit,
	commandSemanticStatus,
} from "./semantic.js";
export { addSignalsParser, commandSignals } from "./signals.js";
export { addSummaryParser, commandSummary } from "./summary.js";
export {
	addSyntaxCallParsers,
	addSyntaxDebugParser,
	addSyntaxParsers,
	addSyntaxRecipeParsers,
	addSyntaxRewriteParsers,
	addSyntaxRuleParser,
	addSyntaxSearchParser,
} from "./syntax.js";
export {
	commandSyntaxDebug,
	commandSyntaxPreview,
	commandSyntaxRecipe,
	commandSyntaxRecipes,
	commandSyntaxRename,
	commandSyntaxReplace,
	commandSyntaxReplaceCall,
	commandSyntaxRule,
} from "./syntax-handlers.js";
