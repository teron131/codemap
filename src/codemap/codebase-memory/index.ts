/** Re-exports optional Codebase Memory MCP integration helpers. */
export {
  callCodebaseMemoryTool,
  codebaseMemoryFailureReason,
  withFreshCodebaseMemoryProject,
} from "./client.js";
export type { CodebaseMemoryChangeOptions, CodebaseMemoryStatusResult } from "./queries.js";
export {
  codebaseMemoryChanges,
  codebaseMemoryIndex,
  codebaseMemoryProjects,
  codebaseMemoryQuery,
  codebaseMemoryQueryRows,
  codebaseMemoryQueryWithProject,
  codebaseMemorySchema,
  codebaseMemoryStatus,
} from "./queries.js";
