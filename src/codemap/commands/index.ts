/** Re-exports command parsers, dispatchers, and handlers. */

export {
  addBackendParsers,
  addIndexParser,
  commandBackendChanges,
  commandBackendProjects,
  commandBackendQuery,
  commandBackendSchema,
  commandBackendStatus,
  commandIndex,
} from "./backend.js";
export { buildParser, dispatch, main, run } from "./cli.js";
export { addInspectParser, commandInspect } from "./inspect.js";
export { addProjectRootArgument, PROJECT_ROOT_HELP } from "./options.js";
export { addSearchParser, commandSearch, printSourceMatches } from "./search.js";
export {
  addSearchCallsParser,
  addSearchMatchParser,
  addSearchRuleParser,
  commandSearchCalls,
  commandSearchMatch,
  commandSearchRule,
} from "./search-structural.js";
export { addSignalsParser, commandSignals } from "./signals.js";
export { addSummaryParser, commandSummary } from "./summary.js";
