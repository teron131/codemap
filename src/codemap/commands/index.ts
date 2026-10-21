/** CLI entry points: `run` for the installed bin, plus one handler per command that tests call with parsed options. */
export {
  commandBackendChanges,
  commandBackendProjects,
  commandBackendQuery,
  commandBackendSchema,
  commandBackendStatus,
  commandIndex,
} from "./backend.js";
export { buildParser, dispatch, main, run } from "./cli.js";
export { commandInspect } from "./inspect.js";
export { commandSearch } from "./search.js";
export { commandSignals } from "./signals.js";
export { commandSummary } from "./summary.js";
