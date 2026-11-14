/** Assembles `signals` output from working-tree sections. `top` and `all` also carry Codebase Memory function metrics labeled with their freshness. */
import { buildDocstringsData } from "../source/docstrings/index.js";
import { buildInventory } from "../source/extraction/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT } from "../source/graph/index.js";
import { discoverFiles } from "../source/scanner/index.js";
import { buildSignalSections, type SignalSectionName } from "./build.js";
import { addBackendFunctionMetrics } from "./codebase-memory.js";
import { buildLightweightSignalPayload } from "./lightweight.js";
import { buildSignalPayload, selectPayloadSection } from "./payload.js";
import type { SignalSection } from "./schema.js";

/** Throws when working-tree analysis fails; backend failures only mark the payload's `freshness` as degraded. */
export function buildSignalView(
  root: string,
  section: SignalSection,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  const payload = buildWorkingTreeSignalPayload(root, section, { includeTests });
  return addBackendFunctionMetrics(payload, section, root, { includeTests });
}

/** The docstring sections skip the detailed-analysis limit: `docstrings` reads reports without scanning, and `docstring-signals` previews at most three files. */
function buildWorkingTreeSignalPayload(
  root: string,
  section: SignalSection,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  if (section === "docstrings") {
    return { docstrings: buildDocstringsData(root) };
  }
  const files = discoverFiles(root);
  if (section === "docstring-signals") {
    const sections = buildSignalSections(root, { names: ["docstringSignals"], files });
    return { docstring_signals: sections.docstringSignals ?? {} };
  }
  if (files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
    const payload = buildLightweightSignalPayload(buildInventory(root, files), {
      includeTests,
      root,
    });
    return selectPayloadSection(payload, section);
  }
  const payload = buildSignalPayload(analyzedSections(root, sectionNames(section), files), {
    includeTests,
  });
  return selectPayloadSection(payload, section);
}

function analyzedSections(root: string, names: SignalSectionName[], files: string[]) {
  try {
    return buildSignalSections(root, { names, files });
  } catch (error) {
    throw new Error(
      `Signals unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Selects collection work before scanning so focused views do not calculate discarded sections. */
function sectionNames(section: SignalSection): SignalSectionName[] {
  switch (section) {
    case "all":
      return ["relationships", "usage", "functionLengths", "fileProfiles", "docstringSignals"];
    case "relationships":
      return ["relationships"];
    case "files":
      return ["fileProfiles"];
    case "lengths":
      return ["functionLengths"];
    default:
      return ["usage"];
  }
}
