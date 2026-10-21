/** Optional Codebase Memory backend behind a cross-process project lock. Each operation runs against a freshly rebuilt index and returns null, with a recorded reason, when the provider fails. */
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
