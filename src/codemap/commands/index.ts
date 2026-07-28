/** Re-exports the CLI runner and one handler per command. */
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
