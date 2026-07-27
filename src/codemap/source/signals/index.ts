/** Re-exports signal analysis builders, payloads, and renderers. */
export {
  countIdentifierOccurrences,
  fileProfileRow,
  functionLengthSection,
  functionUsageRows,
  IDENTIFIER_RE,
  topHubs,
  topInheritanceHubs,
  usageBins,
  usageRows,
  variableUsageRows,
} from "./analysis.js";
export { buildSignalExport, runSignalsExport } from "./build.js";
export { buildSignalPayload, selectPayloadSection } from "./payload.js";
export { isGeneratedSignalPath, isTestPath, SIGNAL_SECTION_CHOICES } from "./policy.js";
export { renderSignalText } from "./render.js";
export type {
  DefinitionRow,
  DenseFileRow,
  FileCountRow,
  FileProfileRow,
  FileSignalCounters,
  FunctionLengthItem,
  FunctionLengthSection,
  LanguageRows,
  NameFrequencyRow,
  SignalFocusEntry,
  SignalLanguage,
  SignalRow,
} from "./schema.js";
export { buildUsageSection, metricNames } from "./usage.js";
export { buildSignalView } from "./workflow.js";
