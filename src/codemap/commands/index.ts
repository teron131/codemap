/** Re-exports command parsers, dispatchers, and handlers. */
export { buildParser, dispatch, main, run } from "./cli.js";
export { addIndexParser, commandIndex } from "./index-memory.js";
export { addInspectParser, commandInspect } from "./inspect.js";
export {
	addMemoryParsers,
	commandMemoryChanges,
	commandMemoryProjects,
	commandMemoryQuery,
	commandMemorySchema,
	commandMemoryStatus,
} from "./memory.js";
export { addProjectRootArgument, PROJECT_ROOT_HELP } from "./options.js";
export {
	addSearchParser,
	commandSearch,
	printSourceMatches,
} from "./search.js";
export {
	addSearchCallsParser,
	addSearchMatchParser,
	addSearchRuleParser,
	commandSearchCalls,
	commandSearchMatch,
	commandSearchRule,
} from "./search-structural.js";
export {
	addSignalsParser,
	commandSignals,
} from "./signals.js";
export { addSummaryParser, commandSummary } from "./summary.js";
