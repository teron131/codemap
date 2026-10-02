/** Re-exports signal view building, section vocabulary, and rendering. */
export { fileProfileRow, functionLengthSection } from "./analysis.js";
export { selectPayloadSection } from "./payload.js";
export type { DenseFileRow, FunctionLengthItem } from "./schema.js";
export { isSignalSection, SIGNAL_SECTION_CHOICES } from "./schema.js";
export { renderSignalText } from "./render.js";
export { buildSignalView } from "./workflow.js";
