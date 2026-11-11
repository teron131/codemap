/** Ranked source metrics for `signals` from the working tree, with Codebase Memory function metrics in `top` and `all`. */
export { denseFileCounters, fileProfileRow } from "./file-profile.js";
export { functionLengthSection } from "./function-lengths.js";
export { selectPayloadSection } from "./payload.js";
export type { DenseFileRow, FileProfileRow, FunctionLengthItem } from "./schema.js";
export { isSignalSection, SIGNAL_SECTION_CHOICES } from "./schema.js";
export { renderSignalText } from "./render.js";
export { buildSignalView } from "./workflow.js";
